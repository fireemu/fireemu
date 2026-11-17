// The in-recipe gRPC flow of a write-stream delete (seed, stream delete, read-back, cleanup),
// driven through a fake gRPC client that keeps a small world of one document. No network: the
// fake replaces the client, so these tests can say what the flow sends, in what order, and
// that it never leaves the large document behind.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  createUnaryRpcCounter,
  runWriteStreamDeleteRecipe,
  validateWriteStreamDeleteRecipe,
} from "./firestore-probe/stream-session.mjs";

const TOKEN = "ya29.fake-bearer-for-tests";
const NAME_PREFIX = "projects/fireemu-oracle-sbx/databases/(default)/documents/";
const recipe = (count = 12_113) => {
  const collection = `wlstream${count}`.padEnd(998, "c");
  return validateWriteStreamDeleteRecipe({
    id: `writes/limits/write-stream-delete/${count}`,
    transport: "grpc",
    action: "write-stream-delete",
    arrayCount: count,
    documentName: `${NAME_PREFIX}${collection}/d`,
    maxFrames: 2,
    maxUnaryRpcs: 6,
  });
};
const grpcError = (code, details) => Object.assign(new Error(details), { code, details });

/**
 * One document, the way production behaves around the delete boundary: a delete of an array
 * of 12,112 or more values is refused with "Transaction too big" (code 3), the transform that
 * removes values is accepted, and a smaller document deletes.
 */
function fakeWorld(options = {}) {
  const world = {
    rpcs: [],
    requests: [],
    headers: [],
    streamFrames: [],
    halfCloses: 0,
    closed: 0,
    count: null,
    ...options,
  };
  const refuseAt = world.refuseAt ?? 12_112;
  const doc = () => ({
    fields: { a: { arrayValue: { values: Array.from({ length: world.count }, () => ({})) } } },
  });
  const client = {
    async commit(request, callOptions) {
      const write = request.writes[0];
      const kind = write.update ? "seed" : write.transform ? "shrink" : "delete";
      world.rpcs.push(`commit:${kind}`);
      world.requests.push({ kind, request });
      world.headers.push(callOptions.otherArgs.headers.authorization);
      const failure = world[`${kind}Error`];
      if (failure) throw grpcError(failure, `${kind} failed`);
      if (kind === "seed") {
        world.count = write.update.fields.a.arrayValue.values.length;
      } else if (kind === "shrink") {
        world.count -= write.transform.fieldTransforms[0].removeAllFromArray.values.length;
      } else {
        if (world.count >= refuseAt) {
          throw grpcError(3, "Transaction too big. Decrease transaction size.");
        }
        world.count = null;
      }
      return [{ writeResults: [{}] }];
    },
    async getDocument(request, callOptions) {
      world.rpcs.push("getDocument");
      world.headers.push(callOptions.otherArgs.headers.authorization);
      if (world.readError) throw grpcError(world.readError, "read failed");
      if (world.count === null)
        throw grpcError(5, world.notFoundDetails ?? `Document "${request.name}" not found.`);
      return [doc()];
    },
    write(callOptions) {
      world.rpcs.push("write");
      world.headers.push(callOptions.otherArgs.headers.authorization);
      const call = new EventEmitter();
      let refused = false;
      call.write = (frame) => {
        world.streamFrames.push(frame);
        queueMicrotask(() => {
          if (frame.database) {
            call.emit("data", { streamId: "stream-1", streamToken: Buffer.from("t1") });
            return;
          }
          if (world.count >= refuseAt && !world.streamAcceptsDelete) {
            refused = true;
            const status = {
              code: 3,
              details: "Transaction too big. Decrease transaction size.",
              metadata: { getMap: () => ({}) },
            };
            call.emit("error", status);
            call.emit("status", status);
            call.emit("end");
            call.emit("close");
            return;
          }
          world.count = null;
          call.emit("data", {
            streamToken: Buffer.from("t2"),
            commitTime: { seconds: "1", nanos: 2 },
            writeResults: [{ updateTime: { seconds: "1", nanos: 2 } }],
          });
        });
      };
      call.end = () => {
        world.halfCloses += 1;
        if (refused || world.noStatus) return;
        queueMicrotask(() => {
          call.emit("status", {
            code: world.finalCode ?? 0,
            details: world.finalDetails ?? "",
            metadata: { getMap: () => ({}) },
          });
          call.emit("end");
          call.emit("close");
        });
      };
      call.destroy = () => {};
      return call;
    },
    async close() {
      world.closed += 1;
    },
  };
  world.client = client;
  return world;
}

async function run(world, count = 12_113, extra = {}) {
  const counter = createUnaryRpcCounter();
  const result = await runWriteStreamDeleteRecipe(recipe(count), {
    connection: { host: "127.0.0.1", port: 1, tls: false },
    projectId: "fireemu-oracle-sbx",
    token: TOKEN,
    makeClient: () => world.client,
    counter,
    streamTimeoutMs: 200,
    ...extra,
  });
  return { result, counter };
}

const eventTypes = (result) => result.events.map((event) => event.type);

test("a delete the stream accepts: seed, handshake, delete frame, half-close, absent read-back, no cleanup", async () => {
  const world = fakeWorld({ streamAcceptsDelete: true });
  const { result, counter } = await run(world);
  assert.deepEqual(world.rpcs, ["commit:seed", "write", "getDocument"]);
  assert.equal(counter.used, 3);
  const seed = world.requests[0].request.writes[0];
  assert.deepEqual(seed.currentDocument, { exists: false });
  assert.equal(seed.update.name, recipe().documentName);
  assert.equal(seed.update.fields.a.arrayValue.values.length, 12_113);
  assert.equal(world.streamFrames.length, 2);
  assert.deepEqual(world.streamFrames[0], {
    database: "projects/fireemu-oracle-sbx/databases/(default)",
  });
  assert.deepEqual(world.streamFrames[1], {
    streamToken: Buffer.from("t1"),
    writes: [{ delete: recipe().documentName }],
  });
  assert.equal(world.halfCloses, 1);
  assert.equal(result.sentFrames, 2);
  assert.equal(result.status.code, 0);
  assert.deepEqual(eventTypes(result), [
    "seed",
    "data",
    "data",
    "status",
    "end",
    "close",
    "readback",
  ]);
  const readback = result.events.at(-1);
  assert.equal(readback.found, false);
  assert.equal(readback.arrayCount, 0);
  assert.equal(readback.status.code, 5);
  assert.equal(result.events[2].value.commitTime, "timestamp");
  assert.equal(world.closed, 1);
  assert.ok(world.headers.every((header) => header === `Bearer ${TOKEN}`));
});

test("a delete the stream refuses: the read-back finds it, then shrink (exists:true, 1,024 values), delete and an absent proof", async () => {
  const world = fakeWorld();
  const { result, counter } = await run(world);
  assert.deepEqual(world.rpcs, [
    "commit:seed",
    "write",
    "getDocument",
    "commit:shrink",
    "commit:delete",
    "getDocument",
  ]);
  assert.equal(counter.used, 6, "the six-RPC budget is met exactly");
  const readback = result.events.find((event) => event.type === "readback");
  assert.equal(readback.found, true);
  assert.equal(readback.arrayCount, 12_113);
  assert.equal(result.status.code, 3);
  const shrink = world.requests.find((r) => r.kind === "shrink").request.writes[0];
  assert.deepEqual(shrink.currentDocument, { exists: true });
  assert.equal(shrink.transform.document, recipe().documentName);
  assert.equal(shrink.transform.fieldTransforms[0].fieldPath, "a");
  assert.equal(shrink.transform.fieldTransforms[0].removeAllFromArray.values.length, 1_024);
  const removal = world.requests.find((r) => r.kind === "delete").request.writes[0];
  assert.deepEqual(removal, { delete: recipe().documentName });
  assert.equal(world.count, null, "nothing large is left behind");
  assert.equal(world.closed, 1);
  assert.ok(world.headers.every((header) => header === `Bearer ${TOKEN}`));
});

test("the cleanup counts are right at each recorded size", async () => {
  for (const count of [12_112, 12_113, 12_122]) {
    const world = fakeWorld();
    await run(world, count);
    assert.equal(world.count, null, String(count));
    const shrink = world.requests.find((r) => r.kind === "shrink").request.writes[0];
    assert.equal(shrink.transform.fieldTransforms[0].removeAllFromArray.values.length, 1_024);
    assert.ok(count - 1_024 < 12_112, "the shrunk document is under every delete boundary");
  }
});

test("a failed cleanup fails the recipe, never silently: shrink, delete and the final absent proof", async () => {
  await assert.rejects(run(fakeWorld({ shrinkError: 3 })), /cleanup shrink failed: 3/);
  await assert.rejects(run(fakeWorld({ deleteError: 14 })), /cleanup delete failed: 14/);
  // The delete is accepted but the document stays (a lost write): the last read must catch it.
  const world = fakeWorld();
  const original = world.client.commit;
  world.client.commit = async (request, options) => {
    const write = request.writes[0];
    if (write.delete && world.count < 12_112) {
      world.rpcs.push("commit:delete");
      return [{}];
    }
    return original(request, options);
  };
  await assert.rejects(run(world), /cleanup left the document/);
});

test("a seed that is refused, a deadline anywhere, and an unclear read-back are indeterminate or failures", async () => {
  await assert.rejects(run(fakeWorld({ seedError: 3 })), /seed was refused: 3/);
  await assert.rejects(run(fakeWorld({ seedError: 4 })), /indeterminate: commit client deadline/);
  await assert.rejects(
    run(fakeWorld({ streamAcceptsDelete: true, readError: 14 })),
    /read-back failed: 14/,
  );
  await assert.rejects(
    run(fakeWorld({ streamAcceptsDelete: true, readError: 4 })),
    /indeterminate: getDocument client deadline/,
  );
  await assert.rejects(
    run(fakeWorld({ streamAcceptsDelete: true, finalCode: 4 })),
    /indeterminate: write-stream client deadline/,
  );
  await assert.rejects(
    run(fakeWorld({ streamAcceptsDelete: true, noStatus: true })),
    /indeterminate: write-stream delete timeout/,
  );
});

test("the recording never carries the bearer, and the sandbox project is normalized away", async () => {
  const leaked = fakeWorld({
    streamAcceptsDelete: true,
    notFoundDetails: `Document leaked ${TOKEN}`,
  });
  await assert.rejects(run(leaked), /private identity or credential/);
  const { result } = await run(fakeWorld({ streamAcceptsDelete: true }));
  const text = JSON.stringify(result);
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes("fireemu-oracle-sbx"));
  assert.ok(
    text.includes("demo-firestore-probe"),
    "the readback message names the recording project",
  );
});

test("the RPC counter ends a recipe that would send a seventh call", async () => {
  const world = fakeWorld();
  const counter = createUnaryRpcCounter(5);
  await assert.rejects(
    runWriteStreamDeleteRecipe(recipe(), {
      connection: { host: "127.0.0.1", port: 1, tls: false },
      projectId: "fireemu-oracle-sbx",
      token: TOKEN,
      makeClient: () => world.client,
      counter,
      streamTimeoutMs: 200,
    }),
    /budget reached/,
  );
  assert.equal(world.closed, 1, "the client is closed on the way out");
});
