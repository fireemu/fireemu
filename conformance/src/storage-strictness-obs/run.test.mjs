import "../storage-signed-put/test-preload.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORS, requests, targetOf, SEND_FLAG } from "./guard.mjs";
import {
  assertNoCredentialOverrides,
  CLEANUP_RESERVE_MS,
  corsCleared,
  exitCode,
  hardDeletes,
  main,
  observe,
  readback,
} from "./run.mjs";
import { createWire } from "./wire.mjs";
import { createFakeWorld } from "./world.fake.mjs";
import { settlement } from "./judge.mjs";

const target = targetOf({
  project: "fireemu-oracle-query",
  defaultBucket: "fireemu-oracle-query.firebasestorage.app",
  runId: "ss-0123abcd",
});
async function run(options = {}, targetOverride = target) {
  const runTarget = targetOverride;
  const entries = [];
  const world = createFakeWorld(runTarget, options);
  const client = createWire({
    target: runTarget,
    net: world.net,
    journal: { append: (entry) => entries.push(entry) },
  });
  const sleeps = [];
  const report = await observe({ target: runTarget, client, sleep: async (ms) => sleeps.push(ms) });
  return { entries, world, client, report, sleeps };
}

test("happy path preserves the complete sequence and deletes every created resource", async () => {
  const { report, world, entries } = await run();
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, true);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.violations, []);
  assert.equal(world.buckets.has(target.tempBucket), false);
  assert.equal(world.buckets.has(target.missingBucket), false);
  assert.equal(world.objects.size, 0);
  assert.deepEqual(
    world.log.map((r) => r.case),
    [
      "P1",
      "P2",
      "P3",
      "P4",
      "W1",
      "W2",
      "W3",
      "W4",
      ...Array.from({ length: 14 }, (_, i) => `A${i + 1}`),
      ...Array.from({ length: 8 }, (_, i) => `C${i + 1}`),
      "R1",
      "R2",
      "R3",
      "F1",
      "F2",
      "K1",
      "K2",
      "K3",
      "K4",
      "K5",
      "K6",
    ],
  );
  assert.equal(report.requests, 41);
  assert.equal(entries.filter((entry) => entry.phase === "before").length, 41);
  for (const r of world.log.filter((request) => request.method === "OPTIONS"))
    assert.equal(r.headers.authorization, undefined);
  assert.equal(world.log.find((r) => r.case === "F1").headers.authorization, "Firebase not-a-jwt");
});

test("P2 refuses anything except 404 before a write and does not clean up another bucket", async () => {
  for (const status of [200, 403, 409, 302, 503]) {
    const { world, report } = await run({ faults: { P2: { status } } });
    assert.equal(report.completed, false);
    assert.ok(world.log.every((r) => r.method === "GET"));
  }
});

test("local rehearsal skips bucket management and closes after verifying object cleanup", async () => {
  const local = { ...target, local: "http://127.0.0.1:9199" };
  const skipped = ["W1", "R1", "R2", "R3", "R4", "R5", "K3", "K-retry", "K4"];
  for (const f2 of [undefined, { status: 403 }, "transport"]) {
    const entries = [];
    const world = createFakeWorld(local, {
      faults: {
        ...Object.fromEntries(skipped.map((id) => [id, { status: 501 }])),
        W2: {
          status: 200,
          body: Buffer.from(JSON.stringify({ name: local.tempBucket, location: "US" })),
        },
        F2: f2,
      },
    });
    world.buckets.set(local.tempBucket, { name: local.tempBucket, location: "US", cors: CORS });
    const client = createWire({
      target: local,
      net: world.net,
      journal: { append: (entry) => entries.push(entry) },
    });
    const sleeps = [];
    const report = await observe({ target: local, client, sleep: async (ms) => sleeps.push(ms) });
    assert.equal(report.completed, f2 !== "transport");
    assert.equal(report.closureReady, f2 !== "transport");
    assert.equal(report.cleanupVerified, f2 !== "transport");
    assert.deepEqual(report.violations, []);
    assert.deepEqual(report.failures, f2 === "transport" ? ["sequence stopped"] : []);
    assert.deepEqual(sleeps, []);
    assert.deepEqual(world.buckets.get(local.tempBucket).cors, CORS);
    assert.equal(world.objects.size, f2 === "transport" ? 1 : 0);
    assert.equal(
      world.log.some((request) => skipped.includes(request.case)),
      false,
    );
    assert.deepEqual(
      entries.filter((entry) => entry.phase === "skipped"),
      skipped.map((id) => ({
        phase: "skipped",
        case: id,
        reason: "local: fireemu has no bucket management",
      })),
    );
    assert.deepEqual(client.entries, entries);
    assert.deepEqual(
      world.log.map((request) => request.case),
      [
        "P1",
        "P2",
        "P3",
        "P4",
        "W2",
        "W3",
        "W4",
        ...Array.from({ length: 14 }, (_, i) => `A${i + 1}`),
        ...Array.from({ length: 8 }, (_, i) => `C${i + 1}`),
        "F1",
        "F2",
        "K1",
        "K2",
        "K5",
        "K6",
        ...(f2 === undefined ? [] : f2 === "transport" ? ["K8", "K9"] : ["K7", "K8", "K9"]),
      ],
    );
    assert.equal(report.requests, world.log.length);
    assert.equal(entries.filter((entry) => entry.phase === "before").length, world.log.length);
    for (const request of world.log) {
      assert.equal(new URL(request.url).origin, local.local);
      assert.equal(
        request.headers.authorization,
        request.case === "F1" ? "Firebase not-a-jwt" : undefined,
      );
    }
  }
});

test("production sequence still sends bucket management, propagation reads and the cleanup retry", async () => {
  const { world, entries, report, sleeps } = await run({
    faults: {
      R3: { status: 200, headers: { "access-control-allow-origin": "*" } },
      R4: { status: 200, headers: { "access-control-allow-origin": "*" } },
      K3: { status: 409 },
    },
  });
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, true);
  assert.deepEqual(
    entries.filter((entry) => entry.phase === "skipped"),
    [],
  );
  for (const id of ["W1", "R1", "R2", "R3", "R4", "R5", "K3", "K-retry", "K4"])
    assert.equal(world.log.filter((request) => request.case === id).length, 1, id);
  assert.deepEqual(sleeps, [20_000, 20_000]);
});

test("a refused bucket create does not authorize deleting the temporary bucket", async () => {
  const { world, report } = await run({ faults: { W1: { status: 409 } } });
  assert.equal(report.completed, false);
  assert.ok(world.log.every((r) => r.method !== "DELETE"));
});

test("W1 unknown followed only by 404 remains unconfirmed", async () => {
  const { report, world } = await run({ faults: { W1: "transport" } });
  assert.equal(report.closureReady, false);
  assert.equal(report.unresolved[0].reason, "unconfirmed create");
  assert.equal(world.log.filter((r) => r.case === "W1").length, 1);
  assert.ok(world.log.some((r) => r.case === "K-read-bucket"));
});

test("each creating request retains its obligation after an unknown answer and only negative reads", async () => {
  for (const id of ["W1", "W3", "W4", "A4", "A10", "A12", "A6", "A7"]) {
    const { report, world } = await run({ faults: { [id]: { status: 503 } } });
    assert.equal(report.closureReady, false, id);
    assert.ok(
      report.unresolved.some(
        (entry) =>
          entry.resource === requests(target)[id].resource && entry.reason === "unconfirmed create",
      ),
      id,
    );
    assert.equal(world.log.filter((r) => r.case === id).length, 1, id);
  }
});

test("unknown creates can be confirmed by an own positive read before deletion", async () => {
  for (const id of ["W1", "W3", "W4"]) {
    const { report } = await run({ faults: { [id]: "transport" }, applyBeforeFault: [id] });
    assert.equal(report.completed, false, id);
    assert.equal(report.closureReady, true, id);
    assert.deepEqual(report.unresolved, [], id);
  }
});

test("an unexpected 200 at A4 is an owned creation and does not silently pass closure", async () => {
  const { report, world } = await run({ faults: { A4: { status: 200 } } });
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, false);
  assert.ok(report.unresolved.some((entry) => entry.resource.endsWith("/o/x")));
  assert.equal(world.log.filter((r) => r.case === "A4").length, 1);
});

test("a bucket 409 lists only owned objects and retries bucket deletion once", async () => {
  const { report, world } = await run({ faults: { K3: { status: 409 } } });
  assert.equal(report.closureReady, true);
  assert.equal(world.log.filter((r) => r.case === "K-list").length, 1);
  assert.equal(world.log.filter((r) => r.case === "K-retry").length, 1);
});

test("a 409 cleanup list removes only the two planned temporary object names", async () => {
  const key = `/storage/v1/b/${target.tempBucket}/o/y`;
  const { report, world } = await run({
    faults: {
      K3: (_r, state) => {
        state.objects.set(key, { name: "y", bucket: target.tempBucket, size: "4" });
        return { status: 409, headers: {}, body: Buffer.alloc(0) };
      },
    },
  });
  assert.equal(report.closureReady, true);
  assert.ok(world.log.some((r) => r.case === "K-delete-t-y"));
  assert.ok(world.log.some((r) => r.case === "K-verify-t-y"));
});

test("a refused object delete is retried only as part of the single nonempty-bucket cleanup", async () => {
  const { report, world } = await run({ faults: { K1: { status: 403 } } });
  assert.equal(report.closureReady, true);
  assert.ok(world.log.some((r) => r.case === "K-delete-t-cors"));
  assert.equal(world.log.filter((r) => r.case === "K-retry").length, 1);
});

test("F2 unknown is sticky and never resent through the JSON dialect", async () => {
  for (const applyBeforeFault of [[], ["F2"]]) {
    const { report, world } = await run({ faults: { F2: "transport" }, applyBeforeFault });
    assert.equal(report.closureReady, false);
    assert.ok(report.unresolved.some((entry) => entry.reason === "unknown delete"));
    assert.equal(
      world.log.filter((r) => r.method === "DELETE" && r.resource === requests(target).F2.resource)
        .length,
      1,
    );
  }
});

test("a refused F2 is removed only after its own positive cleanup read", async () => {
  const { report, world } = await run({ faults: { F2: { status: 403 } } });
  assert.equal(report.closureReady, true);
  assert.deepEqual(
    world.log.slice(-4).map((r) => r.case),
    ["K6", "K7", "K8", "K9"],
  );
});

test("CORS removal records up to three attempts twenty seconds apart", async () => {
  const { world, sleeps } = await run({
    faults: {
      R3: { status: 200, headers: { "access-control-allow-origin": "*" } },
      R4: { status: 200, headers: { "access-control-allow-origin": "*" } },
    },
  });
  assert.deepEqual(
    world.log.filter((r) => /^R[345]$/.test(r.case)).map((r) => r.case),
    ["R3", "R4", "R5"],
  );
  assert.deepEqual(sleeps, [20_000, 20_000]);
});

test("A2 waits ten minutes, uses only reads, and closes a previously unknown delete", async () => {
  const result = await run({ faults: { F2: "transport" }, applyBeforeFault: ["F2"] });
  const endedAt = Date.now();
  const previous = [
    {
      phase: "header",
      runId: target.runId,
      project: target.project,
      defaultBucket: target.defaultBucket,
    },
    ...result.entries,
    { phase: "summary", endedAt },
  ];
  const entries = [];
  const client = createWire({
    target,
    net: result.world.net,
    journal: { append: (entry) => entries.push(entry) },
  });
  await assert.rejects(
    readback({ target, client, previous, now: () => endedAt + 599_999 }),
    /ten-minute/,
  );
  assert.equal(entries.length, 0);
  const report = await readback({ target, client, previous, now: () => endedAt + 600_000 });
  assert.equal(report.closureReady, true);
  assert.ok(entries.filter((e) => e.phase === "before").every((e) => e.method === "GET"));
  assert.deepEqual(
    entries
      .filter((e) => e.phase === "before")
      .slice(0, 3)
      .map((e) => e.case),
    ["A2-bucket", "A2-prefix", "A2-object"],
  );
});

test("settlement near misses keep unknown creates and deletes open", () => {
  const resource = "resource";
  const event = (action, status, extra = {}) => ({
    phase: "after",
    resource,
    action,
    status,
    ...extra,
  });
  const ready = (...entries) => settlement(entries).closureReady;
  for (const status of [null, 199, 302, 503]) {
    assert.equal(ready(event("create", status), event("read", 404)), false);
    assert.equal(ready(event("create", status), event("read", 404, { session: "a2" })), false);
    assert.equal(
      ready(event("create", status), event("create", 409), event("read", 404, { session: "a2" })),
      false,
    );
    assert.equal(
      ready(
        event("create", status),
        event("create", 200),
        event("delete", 204),
        event("read", 404),
      ),
      false,
    );
    assert.equal(ready(event("create", status), event("delete", 204), event("read", 404)), false);
    assert.equal(
      ready(
        event("create", status),
        event("read", 200, { showsResource: true }),
        event("delete", 204),
        event("read", 404),
      ),
      true,
    );
    assert.equal(
      ready(event("create", status), event("read", 200), event("delete", 204), event("read", 404)),
      false,
    );
    assert.equal(
      ready(
        event("create", 200),
        event("delete", status),
        event("delete", 204),
        event("read", 404),
      ),
      false,
    );
    assert.equal(
      ready(
        event("create", 200),
        event("delete", status),
        event("delete", 409),
        event("read", 404),
      ),
      false,
    );
    assert.equal(
      ready(event("create", 200), event("delete", status), event("read", 404, { session: "a2" })),
      true,
    );
  }
  assert.equal(ready(event("create", 200), event("read", 404)), false);
  assert.equal(ready(event("create", 200), event("read", 404, { session: "a2" })), true);
  assert.equal(ready(event("create", 200), event("delete", 204), event("read", 404)), true);
  assert.equal(ready(event("create", 200), event("read", 404), event("delete", 204)), false);
  assert.equal(
    ready(event("create", 200), event("delete", 204), event("read", 200, { showsResource: true })),
    false,
  );
  assert.equal(
    ready(
      event("create", 200),
      event("delete", 204),
      event("read", 200, { showsResource: true }),
      event("read", 404),
    ),
    false,
  );
  assert.equal(ready(event("create", 409)), true);
  assert.equal(ready(event("read", 200, { showsResource: true })), true);
  assert.equal(ready({ phase: "before", n: 1, resource, action: "create" }), false);
});

test("readback refuses each mismatched journal identity before sending", async () => {
  const endedAt = 1_000_000;
  const header = {
    phase: "header",
    runId: target.runId,
    project: target.project,
    defaultBucket: target.defaultBucket,
  };
  const summary = { phase: "summary", endedAt };
  const world = createFakeWorld(target);
  const client = createWire({ target, net: world.net, journal: { append() {} } });
  for (const previous of [
    [{ ...header, phase: "other" }, summary],
    [{ ...header, runId: "other" }, summary],
    [{ ...header, project: "other" }, summary],
    [{ ...header, defaultBucket: "other" }, summary],
    [header, { ...summary, phase: "other" }],
    [header, { ...summary, endedAt: null }],
  ])
    await assert.rejects(
      readback({ target, client, previous, now: () => endedAt + 600_000 }),
      /matching completed journal/,
    );
  assert.equal(client.budget.count, 0);
});

test("preflight list rejects each incomplete or unexpected layout", async () => {
  for (const body of [
    "null",
    "[]",
    "invalid",
    JSON.stringify({ kind: "other" }),
    JSON.stringify({ items: [{}] }),
    JSON.stringify({ items: {} }),
    JSON.stringify({ prefixes: ["x"] }),
    JSON.stringify({ prefixes: {} }),
    JSON.stringify({ nextPageToken: "more" }),
    JSON.stringify({ unexpected: true }),
  ]) {
    const { report, world } = await run({
      faults: { P4: { status: 200, body: Buffer.from(body) } },
    });
    assert.equal(report.completed, false, body);
    assert.equal(report.cleanupVerified, false, body);
    assert.ok(
      world.log.every((request) => request.method === "GET"),
      body,
    );
  }
});

test("cleanup verification fails for each missing or unknown final read", async () => {
  for (const id of ["K2", "K4", "K5", "K6"]) {
    for (const fault of [{ status: 503 }, { status: 403 }]) {
      const { report } = await run({ faults: { [id]: fault } });
      assert.equal(report.cleanupVerified, false, id);
      assert.equal(report.closureReady, false, id);
    }
  }
});

test("main selects fake mode and rejects invalid mode arguments and credential overrides", async () => {
  const directory = mkdtempSync(join(tmpdir(), "strictness-main-"));
  const args = [
    "--project",
    target.project,
    "--default-bucket",
    target.defaultBucket,
    "--out",
    join(directory, "fake"),
  ];
  const oldFlag = process.env[SEND_FLAG];
  const oldCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const originalLog = console.log;
  try {
    delete process.env[SEND_FLAG];
    console.log = () => {};
    assert.equal(await main(args), 0);
    const header = JSON.parse(
      readFileSync(join(directory, "fake", "journal.jsonl"), "utf8").split("\n")[0],
    );
    assert.equal(header.mode, "fake");
    await assert.rejects(
      main([...args, "--local", "http://localhost:9199", "--send"]),
      /invalid arguments/,
    );
    await assert.rejects(main([...args, "--run-id", target.runId]), /invalid arguments/);
    await assert.rejects(main(["readback", ...args]), /invalid arguments/);
    await assert.rejects(main(["unexpected", ...args]), /invalid arguments/);
    process.env[SEND_FLAG] = "launch-script";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "synthetic";
    const productionArgs = [
      "--project",
      target.project,
      "--default-bucket",
      target.defaultBucket,
      "--out",
      join(directory, "refused"),
      "--send",
    ];
    await assert.rejects(main(productionArgs), /credential overrides refused/);
  } finally {
    console.log = originalLog;
    if (oldFlag === undefined) delete process.env[SEND_FLAG];
    else process.env[SEND_FLAG] = oldFlag;
    if (oldCredentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = oldCredentials;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bucket cleanup refuses incomplete and unplanned listings", async () => {
  for (const [body, failure] of [
    [JSON.stringify({ nextPageToken: "more", items: [] }), "temporary bucket list not complete"],
    [JSON.stringify({ items: {} }), "temporary bucket list not complete"],
    [JSON.stringify({ items: [{ name: "outside" }] }), "unplanned object in temporary bucket"],
  ]) {
    const { report, world } = await run({
      faults: { K3: { status: 409 }, "K-list": { status: 200, body: Buffer.from(body) } },
    });
    assert.ok(report.failures.includes(failure), body);
    assert.equal(
      world.log.some(
        (request) => request.method === "DELETE" && request.resource?.endsWith("/o/outside"),
      ),
      false,
    );
  }
});

test("--send without the launch-script flag is refused before any file or request, never run against the fake world", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ss-send-flag-"));
  const saved = process.env[SEND_FLAG];
  try {
    for (const value of [undefined, "", "launch", "LAUNCH-SCRIPT"]) {
      if (value === undefined) delete process.env[SEND_FLAG];
      else process.env[SEND_FLAG] = value;
      const out = join(dir, `out-${String(value)}`);
      await assert.rejects(
        main([
          "--send",
          "--project",
          "fireemu-oracle-query",
          "--default-bucket",
          "fireemu-oracle-query.firebasestorage.app",
          "--out",
          out,
        ]),
        /production send flag required/,
      );
      assert.throws(() => readFileSync(join(out, "journal.jsonl")), /ENOENT/);
    }
  } finally {
    if (saved === undefined) delete process.env[SEND_FLAG];
    else process.env[SEND_FLAG] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preconditions reject independently invalid metadata and CORS answers", async () => {
  for (const [id, fault] of [
    ["P1", { status: 403, body: Buffer.from('{"location":"US"}') }],
    ["P1", { status: 200, body: Buffer.from("{}") }],
    ["W2", { status: 403, body: Buffer.from(JSON.stringify({ cors: CORS })) }],
    ["W2", { status: 200, body: Buffer.from("{}") }],
    ["R2", { status: 403, body: Buffer.from("{}") }],
    ["R2", { status: 200, body: Buffer.from("invalid") }],
    ["R2", { status: 200, body: Buffer.from('{"cors":[{"origin":["*"]}]}') }],
    ["R2", { status: 200, body: Buffer.from('{"cors":null}') }],
    ["W2", { status: 200, body: Buffer.from(JSON.stringify({ cors: CORS })) }],
    [
      "W2",
      {
        status: 200,
        body: Buffer.from(
          JSON.stringify({ cors: CORS, softDeletePolicy: { retentionDurationSeconds: "604800" } }),
        ),
      },
    ],
  ]) {
    const { report } = await run({ faults: { [id]: fault } });
    assert.equal(report.completed, false, id);
    assert.ok(report.violations.includes(id), id);
  }
});

test("readback requires every absent response and an empty prefix listing", async () => {
  const endedAt = 1_000_000;
  const previous = [
    {
      phase: "header",
      runId: target.runId,
      project: target.project,
      defaultBucket: target.defaultBucket,
    },
    { phase: "summary", endedAt },
  ];
  for (const id of [
    "A2-bucket",
    "A2-prefix",
    "A2-object",
    "A2-cors",
    "A2-t-y",
    "A2-m-x",
    "A2-m-y",
  ]) {
    for (const fault of id === "A2-prefix"
      ? [{ status: 200, body: Buffer.from('{"items":[{}]}') }, { status: 503 }]
      : [{ status: 200 }, { status: 503 }]) {
      const world = createFakeWorld(target, { faults: { [id]: fault } });
      const client = createWire({ target, net: world.net, journal: { append() {} } });
      const result = await readback({ target, client, previous, now: () => endedAt + 600_000 });
      assert.equal(result.readbackVerified, false, id);
      assert.equal(result.closureReady, false, id);
    }
  }
});

test("cleanup does not delete a bucket whose creation was refused", async () => {
  const { report, world } = await run({ faults: { W1: { status: 409 } } });
  assert.equal(report.completed, false);
  assert.equal(
    world.log.some((request) => ["K1", "K3", "K-retry"].includes(request.case)),
    false,
  );
});

test("W1 asks for hard deletes and W2 must report them (presend Should 1)", () => {
  const body = JSON.parse(requests(target).W1.body);
  assert.deepEqual(body.softDeletePolicy, { retentionDurationSeconds: 0 });
  assert.equal(hardDeletes({ retentionDurationSeconds: "0" }), true);
  assert.equal(hardDeletes({ retentionDurationSeconds: 0 }), true);
  for (const value of [
    undefined,
    null,
    {},
    { retentionDurationSeconds: "604800" },
    { retentionDurationSeconds: "" },
  ])
    assert.equal(hardDeletes(value), false, JSON.stringify(value));
});

test("R2 accepts cors absent or [] and nothing else (presend Should 2)", async () => {
  assert.equal(corsCleared({ name: "b" }), true);
  assert.equal(corsCleared({ name: "b", cors: [] }), true);
  for (const value of [null, [], { cors: null }, { cors: [{}] }, { cors: {} }])
    assert.equal(corsCleared(value), false, JSON.stringify(value));
  const { report } = await run({
    faults: { R2: { status: 200, body: Buffer.from('{"name":"x","cors":[]}') } },
  });
  assert.equal(report.completed, true);
  assert.deepEqual(report.violations, []);
});

test("the sequence stops at the cleanup reserve and the cleanup still runs (presend Should 3)", async () => {
  assert.equal(CLEANUP_RESERVE_MS, 5 * 60_000);
  const world = createFakeWorld(target);
  let t = 0;
  const now = () => t;
  const client = createWire({
    target,
    net: world.net,
    journal: { append() {} },
    now,
    deadline: 15 * 60_000,
  });
  const sent = [];
  client.wire = ((wire) => async (request, location) => {
    sent.push(request.case);
    if (request.case === "A1") t = 15 * 60_000 - CLEANUP_RESERVE_MS + 1;
    return wire(request, location);
  })(client.wire);
  const report = await observe({ target, client, sleep: async () => {} });
  assert.equal(report.completed, false);
  assert.ok(sent.includes("A1") && !sent.includes("A2"), sent.join(" "));
  assert.ok(sent.includes("K3"), "the cleanup ran after the stop");
});

test("the exit code is 0 only for a closed run: completed and closureReady, or a closed A2 (presend Should 4)", () => {
  assert.equal(exitCode({ closureReady: true, completed: true }, false), 0);
  assert.equal(exitCode({ closureReady: true, completed: false }, false), 1);
  assert.equal(exitCode({ closureReady: false, completed: true }, false), 1);
  assert.equal(exitCode({ closureReady: true }, true), 0);
  assert.equal(exitCode({ closureReady: false }, true), 1);
});

test("credential override variables are refused one by one (presend Should 4)", () => {
  assert.doesNotThrow(() => assertNoCredentialOverrides({ PATH: "/bin", HOME: "/h" }));
  for (const key of ["GOOGLE_APPLICATION_CREDENTIALS", "CLOUDSDK_CONFIG", "CLOUDSDK_CORE_PROJECT"])
    assert.throws(
      () => assertNoCredentialOverrides({ PATH: "/bin", [key]: "x" }),
      /credential overrides refused/,
    );
});

test("A2 refuses a journal written in another mode (presend Should 4)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ss-a2-mode-"));
  try {
    const header = {
      phase: "header",
      mode: "production",
      runId: target.runId,
      project: target.project,
      defaultBucket: target.defaultBucket,
    };
    const summary = { phase: "summary", endedAt: 1 };
    writeFileSync(
      join(dir, "journal.jsonl"),
      `${JSON.stringify(header)}\n${JSON.stringify(summary)}\n`,
    );
    await assert.rejects(
      main([
        "readback",
        "--project",
        target.project,
        "--default-bucket",
        target.defaultBucket,
        "--run-id",
        target.runId,
        "--out",
        dir,
      ]),
      /A2 mode must match the original run/,
    );
    assert.throws(() => readFileSync(join(dir, "readback.jsonl")), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const v3 = targetOf({ ...target, stage: "v3" });

test("v3 records all three CORS states and closes objects, sessions and bucket", async () => {
  const { report, world, entries } = await run({}, v3);
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, true);
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.requests, 40);
  assert.equal(world.log.filter((request) => request.case === "V3-K-read-object").length, 1);
  assert.equal(
    world.log.some((request) => request.case === "V3-K-read-created-bucket"),
    false,
  );
  assert.equal(world.buckets.has(v3.tempBucket), false);
  assert.equal(world.objects.size, 0);
  assert.equal(world.sessions.size, 0);
  for (const state of ["absent", "empty", "configured"]) {
    for (const endpoint of [
      "metadata",
      "media",
      "bucket",
      "list",
      "acl",
      "preflight",
      "resumable",
    ]) {
      const request = world.log.find((r) => r.case === `V3-${state}-${endpoint}`);
      assert.ok(request, `${state}/${endpoint}`);
      assert.equal(request.headers.origin, "http://localhost:3000");
      assert.ok(
        request.url.includes(`/b/${v3.tempBucket}/`) || request.url.endsWith(`/b/${v3.tempBucket}`),
      );
    }
  }
  assert.ok(
    world.log.filter((r) => r.url.includes(v3.defaultBucket)).every((r) => r.method === "GET"),
  );
  assert.equal(entries.at(-1).case, "V3-K-bucket");
  assert.equal(entries.at(-1).status, 404);
  assert.ok(!JSON.stringify(entries).includes("synthetic-session-"));
});

test("v3 stops at each unknown probe and still performs cleanup", async () => {
  for (const state of ["absent", "empty", "configured"]) {
    for (const endpoint of [
      "metadata",
      "media",
      "bucket",
      "list",
      "acl",
      "preflight",
      "resumable",
    ]) {
      const id = `V3-${state}-${endpoint}`;
      const { report, world } = await run({ faults: { [id]: "transport" } }, v3);
      assert.equal(report.completed, false, id);
      assert.equal(report.closureReady, false, id);
      assert.equal(world.buckets.has(v3.tempBucket), false, id);
      assert.equal(world.log.filter((r) => r.case === id).length, 1, id);
    }
  }
});

test("v3 partial cleanup never repeats an unknown delete or closes unresolved sessions", async () => {
  for (const id of [
    "V3-K-object",
    "V3-K-delete-bucket",
    "V3-absent-cancel",
    "V3-absent-session-read",
  ]) {
    const { report, world } = await run(
      { faults: { [id]: "transport" }, applyBeforeFault: [id] },
      v3,
    );
    assert.equal(report.closureReady, false, id);
    assert.equal(world.log.filter((r) => r.case === id).length, 1, id);
    assert.ok(
      world.log.some((r) => r.case === "V3-K-bucket"),
      id,
    );
  }
});

test("v3 rejects a racing bucket and unsafe configuration readbacks", async () => {
  for (const id of [
    "V3-P-absent",
    "V3-W-bucket",
    "V3-W-verify",
    "V3-empty-verify",
    "V3-configured-verify",
  ]) {
    const { report, world } = await run(
      { faults: { [id]: { status: id === "V3-W-bucket" ? 409 : 200, body: Buffer.from("{}") } } },
      v3,
    );
    assert.equal(report.completed, false, id);
    if (["V3-P-absent", "V3-W-bucket"].includes(id))
      assert.ok(world.log.every((r) => r.method !== "DELETE"));
  }
});

test("v3 local rehearsal covers three predeclared CORS buckets without management writes", async () => {
  const { rehearsalConfig } = await import("./rehearse.mjs");
  const local = targetOf({ ...v3, local: "http://127.0.0.1:9199" });
  const config = rehearsalConfig(local);
  assert.equal(config.profile, "strict");
  assert.equal(config.storage.cors[`${v3.tempBucket}-absent`], undefined);
  assert.deepEqual(config.storage.cors[`${v3.tempBucket}-empty`], []);
  assert.deepEqual(config.storage.cors[`${v3.tempBucket}-configured`], CORS);
  const world = createFakeWorld(local);
  for (const bucket of config.storage.buckets)
    world.buckets.set(bucket, {
      name: bucket,
      location: "US",
      ...(Object.hasOwn(config.storage.cors, bucket) ? { cors: config.storage.cors[bucket] } : {}),
    });
  const client = createWire({ target: local, net: world.net, journal: { append() {} } });
  const report = await observe({ target: local, client });
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, true);
  assert.equal(world.objects.size, 0);
  assert.equal(world.sessions.size, 0);
  assert.ok(world.log.every((r) => new URL(r.url).origin === local.local));
  assert.ok(world.log.every((r) => r.headers.authorization === undefined));
  assert.ok(
    world.log
      .filter((r) => r.method !== "GET")
      .every((r) => new URL(r.url).pathname.includes("/o")),
  );
  assert.equal(world.buckets.size, 4);
});

test("v3 unknown creates require positive reads and A2 cannot clear unknown sessions", async () => {
  for (const id of ["V3-W-bucket", "V3-W-object"]) {
    for (const applied of [false, true]) {
      const { report, client, world } = await run(
        { faults: { [id]: "transport" }, applyBeforeFault: applied ? [id] : [] },
        v3,
      );
      assert.equal(report.closureReady, false);
      assert.equal(report.unresolved.length === 0, applied);
      assert.equal(world.buckets.has(v3.tempBucket), false);
      const previous = [
        {
          phase: "header",
          stage: "v3",
          runId: v3.runId,
          project: v3.project,
          defaultBucket: v3.defaultBucket,
        },
        ...client.entries,
        { phase: "summary", ...report, endedAt: 0 },
      ];
      const a2 = createWire({ target: v3, net: world.net, journal: { append() {} } });
      assert.equal(
        (await readback({ target: v3, client: a2, previous, now: () => 600_000 })).closureReady,
        applied,
      );
      await assert.rejects(
        readback({ target, client: a2, previous, now: () => 600_000 }),
        /matching/,
      );
    }
  }
  const { client, world, report } = await run(
    { faults: { "V3-absent-resumable": "transport" }, applyBeforeFault: ["V3-absent-resumable"] },
    v3,
  );
  assert.deepEqual(report.sessionFailures, ["absent"]);
  assert.equal(world.sessions.size, 1);
  const previous = [
    {
      phase: "header",
      stage: "v3",
      runId: v3.runId,
      project: v3.project,
      defaultBucket: v3.defaultBucket,
    },
    ...client.entries,
    { phase: "summary", ...report, endedAt: 0 },
  ];
  const a2 = createWire({ target: v3, net: world.net, journal: { append() {} } });
  const result = await readback({ target: v3, client: a2, previous, now: () => 600_000 });
  assert.equal(result.readbackVerified, true);
  assert.equal(result.closureReady, false);
});

test("v3 preserves the cleanup reserve and fails closed on an exhausted budget", async () => {
  for (const limited of ["reserve", "budget"]) {
    const world = createFakeWorld(v3);
    const budget = {
      count: 0,
      take() {
        if (this.count === 9) throw new Error("budget");
        return ++this.count;
      },
    };
    const client = createWire({
      target: v3,
      net: world.net,
      journal: { append() {} },
      ...(limited === "budget"
        ? { budget }
        : { now: () => (world.log.length >= 6 ? 600_001 : 0), deadline: 900_000 }),
    });
    const report = await observe({ target: v3, client });
    assert.equal(report.completed, false);
    if (limited === "reserve") {
      assert.equal(report.cleanupVerified, true);
      assert.equal(world.buckets.has(v3.tempBucket), false);
    } else {
      assert.equal(report.cleanupVerified, false);
      assert.equal(report.closureReady, false);
      assert.equal(world.log.length, 9);
    }
  }
});

test("v3 known session cleanup failures make cleanup unverified", async () => {
  for (const id of ["V3-absent-cancel", "V3-absent-session-read"]) {
    const { report } = await run({ faults: { [id]: { status: 400 } } }, v3);
    assert.equal(report.cleanupVerified, false);
    assert.equal(report.closureReady, false);
    assert.deepEqual(report.sessionFailures, ["absent"]);
  }
});

test("v3 unknown successful bucket creation requires a definite own read before any deletion", async () => {
  for (const fault of [
    { status: 200, body: null },
    { status: 201, body: Buffer.from("fake-owner") },
    { status: 299, headers: { "x-echo": "fake-owner" } },
  ]) {
    for (const read of [
      { status: 404 },
      { status: 200, body: null },
      { status: 200, body: Buffer.from(JSON.stringify({ name: v3.defaultBucket })) },
      { status: 200, body: Buffer.from(JSON.stringify({ name: v3.tempBucket })) },
    ]) {
      const confirmed = read.body?.toString().includes(v3.tempBucket) === true;
      const { world, client, report } = await run(
        {
          faults: { "V3-W-bucket": fault, "V3-K-read-created-bucket": read },
          applyBeforeFault: confirmed ? ["V3-W-bucket"] : [],
        },
        v3,
      );
      assert.equal(report.completed, false);
      assert.equal(report.closureReady, false);
      assert.equal(
        world.log.some((r) => r.method === "DELETE"),
        confirmed,
      );
      assert.equal(report.unresolved.length === 0, confirmed);
      assert.ok(world.log.some((r) => r.case === "V3-K-read-created-bucket"));
      const previous = [
        {
          phase: "header",
          stage: "v3",
          runId: v3.runId,
          project: v3.project,
          defaultBucket: v3.defaultBucket,
        },
        ...client.entries,
        { phase: "summary", ...report, endedAt: 0 },
      ];
      const a2 = createWire({ target: v3, net: world.net, journal: { append() {} } });
      const result = await readback({ target: v3, client: a2, previous, now: () => 600_000 });
      assert.equal(result.readbackVerified, true);
      assert.equal(result.closureReady, confirmed);
    }
  }
});

test("v3 W-verify independently requires absent cors and zero soft-delete retention", async () => {
  for (const [extra, valid] of [
    [{ softDeletePolicy: { retentionDurationSeconds: "0" } }, true],
    [{ softDeletePolicy: { retentionDurationSeconds: 0 } }, true],
    [{ cors: [], softDeletePolicy: { retentionDurationSeconds: "0" } }, false],
    [{ softDeletePolicy: { retentionDurationSeconds: "604800" } }, false],
  ]) {
    const { report, world } = await run(
      {
        faults: {
          "V3-W-verify": {
            status: 200,
            body: Buffer.from(JSON.stringify({ name: v3.tempBucket, ...extra })),
          },
        },
      },
      v3,
    );
    assert.equal(report.completed, valid);
    assert.equal(
      world.log.some((r) => r.case === "V3-W-object"),
      valid,
    );
    assert.equal(report.violations.includes("V3-W-verify"), !valid);
  }
});

test("v3 configured read-back requires every field of the exact CORS rule", async () => {
  for (const cors of [
    [],
    [{ ...CORS[0], origin: ["http://other.example"] }, CORS[1]],
    [CORS[0], { ...CORS[1], method: ["GET"] }],
    [CORS[0], { ...CORS[1], responseHeader: ["*"] }],
    [CORS[0], { ...CORS[1], maxAgeSeconds: 601 }],
  ]) {
    const { report, world } = await run(
      {
        faults: {
          "V3-configured-verify": {
            status: 200,
            body: Buffer.from(JSON.stringify({ name: v3.tempBucket, cors })),
          },
        },
      },
      v3,
    );
    assert.equal(report.completed, false);
    assert.ok(report.violations.includes("V3-configured-verify"));
    assert.equal(
      world.log.some((r) => r.case === "V3-configured-metadata"),
      false,
    );
  }
});

test("v3 unrecorded cancel statuses require coordinator acceptance even after an absent A2", async () => {
  for (const status of [200, 404, 499, 204]) {
    const { report, client, world } = await run(
      {
        faults: { "V3-absent-cancel": { status } },
        applyBeforeFault: ["V3-absent-cancel"],
      },
      v3,
    );
    assert.deepEqual(report.sessionFailures, status === 204 ? [] : ["absent"]);
    assert.equal(report.cleanupVerified, status === 204);
    assert.equal(report.closureReady, status === 204);
    const previous = [
      {
        phase: "header",
        stage: "v3",
        runId: v3.runId,
        project: v3.project,
        defaultBucket: v3.defaultBucket,
      },
      ...client.entries,
      { phase: "summary", ...report, endedAt: 0 },
    ];
    const a2 = createWire({ target: v3, net: world.net, journal: { append() {} } });
    const result = await readback({ target: v3, client: a2, previous, now: () => 600_000 });
    assert.equal(result.readbackVerified, true);
    assert.equal(result.closureReady, status === 204);
  }
});

test("v3 refused or missing-Location resumable starts stop before the next state", async () => {
  for (const status of [200, 201, 400, 403, 404]) {
    const { report, world } = await run({ faults: { "V3-absent-resumable": { status } } }, v3);
    assert.equal(report.completed, false, String(status));
    assert.equal(
      world.log.some((r) => r.case.startsWith("V3-empty-")),
      false,
    );
    assert.equal(
      world.log.some((r) => r.case === "V3-absent-cancel"),
      false,
    );
    assert.equal(world.log.at(-1).case, "V3-K-bucket");
    assert.deepEqual(report.sessionFailures, status < 300 ? ["absent"] : []);
  }
});

test("v3 a body echoing an earlier upload ID is withheld and stops the sequence", async () => {
  const uploadId = "synthetic-earlier-upload-id";
  const { report, world, entries } = await run(
    {
      faults: {
        "V3-absent-metadata": {
          status: 200,
          headers: { "x-guploader-uploadid": uploadId },
          body: Buffer.from("{}"),
        },
        "V3-absent-media": { status: 200, body: Buffer.from(`prefix ${uploadId} suffix`) },
      },
    },
    v3,
  );
  const answer = entries.find((e) => e.phase === "after" && e.case === "V3-absent-media");
  assert.equal(answer.withheld, true);
  assert.equal(answer.unknown, true);
  assert.equal(answer.bodyBase64, "");
  assert.equal(report.completed, false);
  assert.equal(report.closureReady, false);
  assert.equal(
    world.log.some((r) => r.case === "V3-absent-bucket"),
    false,
  );
  assert.ok(!JSON.stringify(entries).includes(uploadId));
  assert.equal(world.log.at(-1).case, "V3-K-bucket");
});

test("v3 preconditions report the exact failed obligation before the next request", async () => {
  for (const [id, status, value, next] of [
    ["V3-P-location", 200, {}, "V3-P-absent"],
    ["V3-P-location", 403, { location: "US" }, "V3-P-absent"],
    ["V3-P-absent", 200, {}, "V3-W-bucket"],
    ["V3-W-bucket", 409, {}, "V3-W-verify"],
    [
      "V3-W-verify",
      200,
      { name: "other", softDeletePolicy: { retentionDurationSeconds: "0" } },
      "V3-W-object",
    ],
    [
      "V3-W-verify",
      403,
      { name: v3.tempBucket, softDeletePolicy: { retentionDurationSeconds: "0" } },
      "V3-W-object",
    ],
    ["V3-W-object", 403, {}, "V3-absent-metadata"],
    ["V3-empty-verify", 403, { name: v3.tempBucket, cors: [] }, "V3-empty-metadata"],
    ["V3-configured-verify", 403, { name: v3.tempBucket, cors: CORS }, "V3-configured-metadata"],
  ]) {
    const { report, world } = await run(
      { faults: { [id]: { status, body: Buffer.from(JSON.stringify(value)) } } },
      v3,
    );
    assert.equal(report.completed, false, id);
    assert.deepEqual(report.violations, [id]);
    assert.deepEqual(report.failures, ["sequence stopped"]);
    assert.equal(
      world.log.some((request) => request.case === next),
      false,
      id,
    );
    if (id === "V3-P-location")
      assert.deepEqual(
        world.log.map((request) => request.case),
        [id],
      );
    if (id === "V3-W-verify") {
      assert.equal(report.cleanupVerified, true);
      assert.equal(report.closureReady, false);
    }
  }
});

test("v3 cleanup distinguishes known absence from unknown or refused readback", async () => {
  for (const [id, status, body, sessionFailure, verified] of [
    ["V3-absent-session-read", 404, null, true, false],
    ["V3-absent-cancel", 204, null, true, false],
    ["V3-absent-session-read", 404, Buffer.alloc(0), false, true],
    ["V3-absent-session-read", 410, Buffer.alloc(0), false, true],
    ["V3-K-bucket", 404, null, false, false],
    ["V3-K-bucket", 403, Buffer.alloc(0), false, false],
    ["V3-K-read-object", 404, null, false, false],
    ["V3-K-read-object", 403, Buffer.alloc(0), false, false],
  ]) {
    const { report } = await run(
      { faults: { [id]: { status, body } }, applyBeforeFault: [id] },
      v3,
    );
    assert.deepEqual(report.sessionFailures, sessionFailure ? ["absent"] : [], id);
    assert.equal(report.cleanupVerified, verified, id);
    assert.equal(report.closureReady, verified, id);
  }
  const { report } = await run(
    {
      faults: {
        "V3-K-object": { status: 403 },
        "V3-K-read-object": { status: 404 },
        "V3-K-delete-bucket": { status: 204 },
        "V3-K-bucket": { status: 404 },
      },
    },
    v3,
  );
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.closureReady, false);
  assert.ok(report.unresolved.some((entry) => entry.resource.endsWith("/o/cors%2Fo.txt")));
});

test("v3 local preconditions stop and ownership reads occur only when needed", async () => {
  const local = targetOf({ ...v3, local: "http://127.0.0.1:9199" });
  for (const [id, fault, applied, violation] of [
    [null, undefined, false, undefined],
    ["V3-P-location", { status: 200, body: Buffer.from("{}") }, false, "V3-P-location"],
    [
      "V3-absent-initial-list",
      { status: 200, body: Buffer.from('{"items":[{}]}') },
      false,
      "V3-absent-initial-list",
    ],
    ["V3-absent-upload", { status: 403 }, false, "V3-absent-upload"],
    ["V3-absent-resumable", { status: 403 }, false, "V3-absent-resumable"],
    ["V3-absent-upload", "transport", true, undefined],
    ["V3-absent-read-object", { status: 404, body: null }, false, undefined],
    ["V3-absent-read-object", { status: 403 }, false, undefined],
  ]) {
    const world = createFakeWorld(local, {
      faults: id ? { [id]: fault } : {},
      applyBeforeFault: applied ? [id] : [],
    });
    for (const state of ["absent", "empty", "configured"]) {
      const name = `${local.tempBucket}-${state}`;
      world.buckets.set(name, { name, location: "US" });
    }
    const client = createWire({ target: local, net: world.net, journal: { append() {} } });
    const report = await observe({ target: local, client });
    const ids = world.log.map((request) => request.case);
    assert.deepEqual(report.violations, violation ? [violation] : [], id);
    if (violation || applied) {
      assert.equal(report.completed, false, id);
      assert.deepEqual(report.failures, ["sequence stopped"]);
      assert.equal(ids.includes("V3-empty-initial-list"), false, id);
    }
    if (id === "V3-P-location") {
      assert.deepEqual(ids, [id]);
      assert.equal(report.cleanupVerified, false);
    }
    if (id === "V3-absent-read-object") assert.equal(report.cleanupVerified, false);
    if (applied) {
      assert.deepEqual(report.unresolved, []);
      assert.deepEqual(ids.slice(-3), [
        "V3-absent-read-object",
        "V3-absent-delete-object",
        "V3-absent-read-object",
      ]);
      assert.equal(report.closureReady, false);
    }
    if (!id) {
      assert.equal(report.closureReady, true);
      assert.deepEqual(
        client.entries.filter((entry) => entry.phase === "skipped"),
        ["absent", "empty", "configured"].map((state) => ({
          phase: "skipped",
          case: `V3-${state}-configuration`,
          reason: "local: predeclared bucket; no bucket management",
        })),
      );
      assert.deepEqual(ids, [
        "V3-P-location",
        ...["absent", "empty", "configured"].flatMap((state) =>
          [
            "initial-list",
            "upload",
            "metadata",
            "media",
            "bucket",
            "list",
            "acl",
            "preflight",
            "resumable",
          ].map((endpoint) => `V3-${state}-${endpoint}`),
        ),
        ...["absent", "empty", "configured"].flatMap((state) =>
          ["cancel", "session-read"].map((endpoint) => `V3-${state}-${endpoint}`),
        ),
        ...["absent", "empty", "configured"].flatMap((state) =>
          ["delete-object", "read-object"].map((endpoint) => `V3-${state}-${endpoint}`),
        ),
      ]);
    }
  }
});

test("v3 CLI writes a stage-bound fake journal and rejects missing output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-v3-cli-"));
  try {
    await assert.rejects(
      main(["v3", "--project", v3.project, "--default-bucket", v3.defaultBucket]),
      { message: "invalid arguments" },
    );
    assert.equal(
      await main([
        "v3",
        "--project",
        v3.project,
        "--default-bucket",
        v3.defaultBucket,
        "--out",
        dir,
      ]),
      0,
    );
    const entries = readFileSync(join(dir, "journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(entries[0].stage, "v3");
    assert.equal(entries[0].mode, "fake");
    assert.equal(entries.at(-1).completed, true);
    assert.equal(entries.at(-1).requests, 40);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("v3 CLI readback checks the original header stage before opening its journal", async () => {
  for (const stage of ["v2", "v3"]) {
    const dir = mkdtempSync(join(tmpdir(), "storage-v3-a2-"));
    try {
      const previous = [
        {
          phase: "header",
          stage,
          mode: "fake",
          runId: v3.runId,
          project: v3.project,
          defaultBucket: v3.defaultBucket,
        },
        { phase: "skipped", case: "synthetic-note" },
        { phase: "summary", endedAt: 0, sessionFailures: [] },
      ];
      writeFileSync(
        join(dir, "journal.jsonl"),
        previous.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      );
      const args = [
        "readback",
        "v3",
        "--project",
        v3.project,
        "--default-bucket",
        v3.defaultBucket,
        "--run-id",
        v3.runId,
        "--out",
        dir,
      ];
      if (stage === "v2") {
        await assert.rejects(main(args), { message: "A2 stage must match the original run" });
        assert.throws(() => readFileSync(join(dir, "readback.jsonl")), /ENOENT/);
      } else {
        assert.equal(await main(args), 0);
        const entries = readFileSync(join(dir, "readback.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(entries[0].stage, "v3");
        assert.equal(entries.at(-1).closureReady, true);
        assert.equal(entries.at(-1).requests, 2);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("the fake transport rejects request drift independently of recorder classification", async () => {
  const plan = requests(v3);
  const request = {
    ...plan["V3-W-bucket"],
    headers: { ...plan["V3-W-bucket"].headers, authorization: "Bearer synthetic-owner" },
  };
  for (const changed of [
    { method: "PUT" },
    { url: request.url + "&extra=1" },
    { body: "{}" },
    { headers: { authorization: "Bearer synthetic-owner", "content-type": "text/plain" } },
    { action: "read" },
    { resource: "/other" },
    { auth: "none" },
    { case: "V3-unrecorded" },
  ]) {
    const world = createFakeWorld(v3, {
      faults: { [changed.case ?? request.case]: { status: 200 } },
    });
    await assert.rejects(world.net({ ...request, ...changed }), /recorded v3 vocabulary/);
    assert.equal(world.buckets.has(v3.tempBucket), false);
    assert.deepEqual(world.log, []);
  }
});
