// The REST request layer of the shared FS-QUERY-INDEX recorder (fs-query-index/session.mjs) and
// of the pipeline lane's copy of it (fs-ent-pipeline/session.mjs): a failure while the response
// body is read is a transport failure of that step, like a failure of the fetch, and a recorded
// program goes on with its next step.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as pipelineHarness from "./fs-ent-pipeline/harness.mjs";
import * as pipelineSession from "./fs-ent-pipeline/session.mjs";
import * as sharedHarness from "./fs-query-index/harness.mjs";
import * as sharedSession from "./fs-query-index/session.mjs";
import { isUnknownRow } from "./fs-query-index/unknown-rows.mjs";
import { BODY_STAGE_PREFIX, bodyReadStageProblems } from "./harness-registry.mjs";

/** Each copy of the request layer, with the harness it imports. */
const LAYERS = [
  ["fs-query-index", sharedHarness, sharedSession],
  ["fs-ent-pipeline", pipelineHarness, pipelineSession],
];

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200 });
/** A response whose status line arrived and whose body then fails with `error`. */
const brokenBody = (error, status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error);
      },
    }),
    { status },
  );

/** Runs `program` against a fake fetch that answers each recorded request from `answers`. */
async function record(layer, program, answers) {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(`${init.method} ${new URL(url).pathname}`);
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const lines = [];
  const session = layer.createSession(layer.ctx, { log: (line) => lines.push(line) });
  try {
    return { ...(await session.runProgram(program)), lines, sent };
  } finally {
    globalThis.fetch = original;
    await session.close();
  }
}

const commitStep = { id: "write", rpc: "commit", body: { writes: [] } };
const queryStep = {
  id: "read",
  rpc: "runQuery",
  body: { structuredQuery: { from: [{ collectionId: "c" }] } },
};
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

for (const [name, harness, session] of LAYERS) {
  const layer = {
    name,
    createSession: session.createSession,
    isTransient: harness.isTransient,
    ctx: harness.createContext({
      run: "1",
      startedMs: Date.UTC(2026, 10, 23),
      target: {
        kind: "local",
        origin: "http://127.0.0.1:9999",
        grpcHost: "127.0.0.1",
        grpcPort: 9999,
      },
    }),
  };

  test(`${layer.name}: a body read that times out after the status line is a transport failure of that step`, async () => {
    const { steps, lines } = await record(layer, { id: "p", steps: [commitStep, queryStep] }, [
      brokenBody(timeout()),
      jsonResponse([]),
    ]);
    assert.deepEqual(steps.write, { status: 0, transportError: "body:TimeoutError" });
    assert.equal(layer.isTransient(steps.write), true);
    // The failure is an unknown answer in the run log, which a write must never settle on.
    assert.equal(lines[0], "p#write 0");
    assert.equal(isUnknownRow(lines[0]), true);
    // The program goes on with its next step and cleans up.
    assert.equal(steps.read.status, 200);
    assert.equal(lines[1], "p#read 200");
  });

  test(`${layer.name}: each body read failure code is recorded with the body marker`, async () => {
    for (const [error, expected] of [
      [Object.assign(new TypeError("terminated"), { cause: { code: "ECONNRESET" } }), "ECONNRESET"],
      [new TypeError("terminated"), "TypeError"],
      [{}, "error"],
    ]) {
      const { steps } = await record(layer, { id: "p", steps: [commitStep] }, [brokenBody(error)]);
      assert.deepEqual(steps.write, { status: 0, transportError: `body:${expected}` });
      // The registry's condition for the recorded fixtures recognises exactly this marker.
      assert.ok(steps.write.transportError.startsWith(BODY_STAGE_PREFIX));
      assert.equal(bodyReadStageProblems({ programs: { p: { steps } } }).length, 1);
    }
  });

  test(`${layer.name}: a fetch failure keeps its own transport error, without the body marker`, async () => {
    const { steps, lines } = await record(layer, { id: "p", steps: [commitStep] }, [timeout()]);
    assert.deepEqual(steps.write, { status: 0, transportError: "TimeoutError" });
    assert.equal(lines[0], "p#write 0");
  });

  test(`${layer.name}: a fetch failure keeps the type of its error code, as before the body read was classified`, async () => {
    const withNumber = Object.assign(new TypeError("fetch failed"), { cause: { code: 17 } });
    const { steps } = await record(layer, { id: "p", steps: [commitStep] }, [withNumber]);
    assert.deepEqual(steps.write, { status: 0, transportError: 17 });
  });

  test(`${layer.name}: a body that is read is recorded as before`, async () => {
    const { steps, raw } = await record(layer, { id: "p", steps: [queryStep] }, [
      jsonResponse([{ readTime: "2026-11-23T00:00:00Z" }]),
    ]);
    assert.equal(steps.read.status, 200);
    assert.equal(raw.read.response.status, 200);
    assert.equal(typeof raw.read.response.text, "string");
  });

  test(`${layer.name}: a harness request whose body cannot be read stops the run instead of passing as empty`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, init) =>
      init.method === "DELETE" ? new Response(null, { status: 200 }) : brokenBody(timeout());
    const session = layer.createSession(layer.ctx, {});
    try {
      await assert.rejects(
        session.runProgram({
          id: "p",
          seed: [["c/d", { a: { integerValue: "1" } }]],
          steps: [queryStep],
        }),
        (error) => error.fatal === true && /harness commit: HTTP 0/.test(error.message),
      );
    } finally {
      globalThis.fetch = original;
      await session.close();
    }
  });
}
