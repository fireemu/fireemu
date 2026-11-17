import "../storage-signed-put/test-preload.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRequest, GuardError, HOSTS, requests, SEND_FLAG, targetOf } from "./guard.mjs";
import { main, observeV4, readback } from "./run.mjs";
import { judgeJournal, settlement } from "./judge.mjs";
import { compare } from "./compare.mjs";
import { createWire } from "./wire.mjs";
import { createFakeWorld } from "./world.fake.mjs";
import { globRegex } from "./world.v4.mjs";
import {
  nest,
  TOKEN_MARK,
  V4_BUDGET,
  V4_COPY_NAME,
  V4_GLOB_LENGTHS,
  V4_GLOBS,
  V4_OBJECTS,
  V4_OBSERVATIONS,
} from "./v4.mjs";
import { v4Facts } from "./v4-judge.mjs";

const identity = {
  stage: "v4",
  project: "fireemu-oracle-query",
  defaultBucket: "fireemu-oracle-query.firebasestorage.app",
};
const target = targetOf({ ...identity, runId: "ss-0123abcd" });
const T = target.tempBucket;
const plan = requests(target);
const empty = () => Buffer.alloc(0);

async function run(options = {}, runTarget = target) {
  const entries = [];
  const world = createFakeWorld(runTarget, options);
  const client = createWire({
    target: runTarget,
    net: world.net,
    journal: { append: (entry) => entries.push(entry) },
  });
  const report = await observeV4({ target: runTarget, client });
  return { entries, world, client, report };
}
const cases = (world) => world.log.map((request) => request.case);
const objectDeletes = (world) =>
  world.log.filter((r) => r.case.startsWith("V4-K-del-")).map((r) => r.case.slice(9));

// A small deterministic generator for the property tests below.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("v4 vocabulary: the fixed requests are exactly those the packet lists", () => {
  assert.equal(Object.keys(plan).length, 104);
  const url = (id) => new URL(plan[id].url);
  const api = `https://storage.googleapis.com/storage/v1/b/${T}`;
  assert.equal(
    plan["V4-L-itd-true"].url,
    `${api}/o?prefix=tl%2F&delimiter=%2F&includeTrailingDelimiter=true`,
  );
  assert.equal(
    plan["V4-L-itd-p1"].url,
    `${api}/o?prefix=tl%2F&delimiter=%2F&includeTrailingDelimiter=true&maxResults=1`,
  );
  assert.equal(plan["V4-L-itd-p2"].url, `${plan["V4-L-itd-p1"].url}&pageToken=${TOKEN_MARK}`);
  assert.equal(plan["V4-L-itd-p2"].token, "V4-L-itd-p1");
  assert.equal(plan["V4-G-p2"].token, "V4-G-p1");
  assert.equal(plan["V4-G-d2"].token, "V4-G-d1");
  assert.equal(
    plan["V4-N-get"].url,
    `https://firebasestorage.googleapis.com/v0/b/${T}/o/tl%2Ff.txt`,
  );
  assert.equal(plan["V4-N-get"].auth, "none");
  assert.equal(plan["V4-N-list"].auth, "none");
  assert.equal(plan["V4-X-xml-delete"].url, `https://storage.googleapis.com/${T}/x/xml.txt`);
  assert.equal(plan["V4-X-xml-delete"].method, "DELETE");
  assert.equal(plan["V4-X-acl-delete"].url, `${api}/o/x%2Facl.txt/acl/allAuthenticatedUsers`);
  assert.equal(
    plan["V4-MD-copy"].url,
    `${api}/o/md%2Fup.txt/copyTo/b/${T}/o/${encodeURIComponent(V4_COPY_NAME)}`,
  );
  assert.equal(plan["V4-B-full"].url, `${api}?projection=full`);
  assert.deepEqual(JSON.parse(plan["V4-B-patch"].body), { labels: { "fireemu-obs": "v4" } });
  assert.deepEqual(JSON.parse(plan["V4-X-acl-insert"].body), {
    entity: "allAuthenticatedUsers",
    role: "READER",
  });
  // A fine-grained bucket with hard deletes; production would otherwise keep soft-deleted copies.
  assert.deepEqual(JSON.parse(plan["V4-W-bucket"].body), {
    name: T,
    location: "US",
    iamConfiguration: { uniformBucketLevelAccess: { enabled: false } },
    softDeletePolicy: { retentionDurationSeconds: 0 },
  });
  // The multipart body names the metadata keys in the order the question needs (not sorted).
  const multipart = plan["V4-U-md-up"].body;
  assert.match(multipart, /"metadata":\{"zeta":"1","alpha":"2","mid":"3"\}/);
  assert.equal(
    plan["V4-U-md-up"].headers["content-type"],
    "multipart/related; boundary=fireemuobsv4",
  );
  assert.ok(multipart.endsWith("\r\n--fireemuobsv4--"));
  assert.equal(plan["V4-U-tl-d1"].body, "");
  assert.ok(url("V4-U-tl-d1").search.includes("name=tl%2Fd1%2F"));
  assert.equal(plan["V4-W-bucket"].resource, `/storage/v1/b/${T}`);
  assert.equal(plan["V4-K-delete-bucket"].action, "delete");
  assert.equal(plan["V4-K-del-pg-b"].action, undefined);
});

test("v4 vocabulary: the glob ladder carries each pattern length exactly, longest last", () => {
  const lengths = V4_GLOBS.filter(([key]) => key.startsWith("len-")).map(([key, pattern]) => [
    Number(key.slice(4)),
    pattern.length,
  ]);
  assert.deepEqual(
    lengths.map(([n]) => n).toSorted((a, b) => a - b),
    V4_GLOB_LENGTHS,
  );
  for (const [n, length] of lengths) assert.equal(length, n);
  assert.equal(V4_OBSERVATIONS.at(-1), "V4-M-len-8000");
  const order = V4_OBSERVATIONS.filter((id) => id.startsWith("V4-M-len-")).map((id) =>
    Number(id.slice(9)),
  );
  assert.deepEqual(
    order,
    [...order].toSorted((a, b) => a - b),
  );
  for (const [key, pattern] of V4_GLOBS) {
    const sent = new URL(plan[`V4-M-${key}`].url).searchParams.get("matchGlob");
    assert.equal(sent, pattern, key);
  }
  assert.equal(nest(1), "{a,zz}");
  assert.equal(nest(3), "{{{a,zz},zz},zz}");
  assert.ok(new URL(plan["V4-M-len-8000"].url).href.length < 8192);
});

test("v4 vocabulary: only P-location names the default bucket and every host is allowed", () => {
  const random = prng(7);
  for (let i = 0; i < 40; i++) {
    const runId = `ss-${Array.from({ length: 8 }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("")}`;
    const p = targetOf({ ...identity, runId });
    const requestsFor = requests(p, i % 2 ? "US" : "us-east1");
    assert.equal(JSON.parse(requestsFor["V4-W-bucket"].body).location, i % 2 ? "US" : "us-east1");
    for (const [id, request] of Object.entries(requestsFor)) {
      assert.equal(request.case, id);
      assert.ok(
        HOSTS.some((host) => request.url.startsWith(`https://${host}/`)),
        id,
      );
      assert.equal(request.url.includes(p.defaultBucket), id === "V4-P-location", id);
      if (id !== "V4-P-location" && id !== "V4-W-bucket")
        assert.ok(request.url.includes(p.tempBucket), id);
    }
  }
});

test("v4 happy path: every object is deleted, the bucket is removed and the sequence closes", async () => {
  const { report, world, entries } = await run();
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, true);
  assert.equal(report.cleanupVerified, true);
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.skipped, ["V4-L-itd-p4"]);
  assert.equal(report.requests, 98);
  assert.ok(report.requests <= V4_BUDGET);
  assert.equal(world.buckets.has(T), false);
  assert.equal(world.objects.size, 0);
  const order = cases(world);
  assert.deepEqual(order.slice(0, 4), [
    "V4-P-location",
    "V4-P-absent",
    "V4-W-bucket",
    "V4-W-verify",
  ]);
  assert.equal(order.at(-3), "V4-K-del-md-copy");
  assert.deepEqual(order.slice(-2), ["V4-K-delete-bucket", "V4-K-bucket"]);
  assert.equal(order.indexOf("V4-M-len-8000"), order.indexOf("V4-K-del-tl-d1") - 1);
  assert.equal(entries.filter((entry) => entry.phase === "before").length, 98);
  assert.equal(entries.filter((entry) => entry.phase === "skipped").length, 1);
  // Deletions of the planned objects only, each once.
  assert.deepEqual(
    objectDeletes(world).toSorted(),
    [...V4_OBJECTS.map(([key]) => key), "md-up", "md-copy"].toSorted(),
  );
  // The production sequence never sends an Origin header or an upload session.
  assert.ok(world.log.every((r) => r.headers.origin === undefined));
});

test("v4 page tokens flow from one answer to the next request only", async () => {
  const { world } = await run();
  const page = (id) => world.log.find((r) => r.case === id);
  const answerToken = (id) => {
    const index = world.log.findIndex((r) => r.case === id);
    return index;
  };
  assert.ok(answerToken("V4-L-itd-p1") < answerToken("V4-L-itd-p2"));
  const p2 = new URL(page("V4-L-itd-p2").url).searchParams.get("pageToken");
  assert.equal(Buffer.from(p2, "base64url").toString(), "tl/d1/");
  assert.equal(
    Buffer.from(new URL(page("V4-G-p2").url).searchParams.get("pageToken"), "base64url").toString(),
    "pg/b",
  );
  // The delete between the two requests happened first.
  assert.ok(answerToken("V4-G-del-b") < answerToken("V4-G-p2"));
  assert.ok(answerToken("V4-G-p1") < answerToken("V4-G-del-b"));
});

test("v4 a missing token skips the dependent request and the run still closes", async () => {
  const strip = (request, { answer }) => {
    const value = JSON.parse(answer.body.toString());
    delete value.nextPageToken;
    return { ...answer, body: Buffer.from(JSON.stringify(value)) };
  };
  const { report, world, entries } = await run({
    faults: { "V4-L-itd-p1": strip, "V4-G-p1": strip },
    applyBeforeFault: ["V4-L-itd-p1", "V4-G-p1"],
  });
  assert.deepEqual(report.skipped, ["V4-L-itd-p2", "V4-L-itd-p3", "V4-L-itd-p4", "V4-G-p2"]);
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, true);
  assert.equal(cases(world).includes("V4-L-itd-p2"), false);
  assert.equal(
    entries.filter((entry) => entry.phase === "skipped" && entry.reason.includes("page token"))
      .length,
    4,
  );
});

test("v4 wire refuses every page token the previous answer did not issue", async () => {
  const world = createFakeWorld(target);
  const client = createWire({ target, net: world.net, journal: { append() {} } });
  for (const id of ["V4-P-location", "V4-P-absent", "V4-W-bucket"]) await client.wire(plan[id]);
  for (const key of V4_OBJECTS.map(([name]) => name)) await client.wire(plan[`V4-U-${key}`]);
  await client.wire(plan["V4-L-itd-p1"]);
  const issued = client.tokens.get("V4-L-itd-p1");
  assert.ok(issued);
  const withToken = (value) => ({
    ...plan["V4-L-itd-p2"],
    url: plan["V4-L-itd-p2"].url.replace(TOKEN_MARK, value),
  });
  const before = client.budget.count;
  for (const bad of [
    TOKEN_MARK,
    "",
    "other",
    `${issued}x`,
    encodeURIComponent("a b"),
    `${issued}&pageToken=${issued}`,
    `${issued}%00`,
  ])
    await assert.rejects(client.wire(withToken(bad)), GuardError, bad);
  assert.equal(client.budget.count, before);
  // Without a recorded token no request is accepted at all, and the right token goes through.
  const fresh = createWire({ target, net: world.net, journal: { append() {} } });
  await assert.rejects(fresh.wire(withToken(issued)), /unissued page token/);
  const answer = await client.wire(withToken(issued));
  assert.equal(answer.status, 200);
});

test("v4 classification: random token characters are admitted exactly when they match the pattern", async () => {
  const random = prng(11);
  const alphabet = "AZaz09._~+/=- <>\"'%&?#\\\n";
  for (let i = 0; i < 300; i++) {
    const length = 1 + Math.floor(random() * 12);
    const token = Array.from(
      { length },
      () => alphabet[Math.floor(random() * alphabet.length)],
    ).join("");
    const url = plan["V4-G-p2"].url.replace(TOKEN_MARK, encodeURIComponent(token));
    const request = { ...plan["V4-G-p2"], url, headers: { authorization: "Bearer x" } };
    const allowed = /^[A-Za-z0-9._~+/=-]+$/.test(token);
    if (allowed) assert.equal(classifyRequest(target, request).case, "V4-G-p2", token);
    else assert.throws(() => classifyRequest(target, request), GuardError, token);
  }
});

test("v4 an invalid issued token stops the sequence and the cleanup still runs", async () => {
  const bad = (request, { answer }) => ({
    ...answer,
    body: Buffer.from(JSON.stringify({ kind: "storage#objects", nextPageToken: "bad token<" })),
  });
  const { report, world } = await run({
    faults: { "V4-L-itd-p1": bad },
    applyBeforeFault: ["V4-L-itd-p1"],
  });
  assert.equal(report.completed, false);
  assert.equal(report.closureReady, false);
  assert.equal(report.cleanupVerified, true);
  assert.equal(world.buckets.has(T), false);
  assert.equal(cases(world).includes("V4-L-itd-p2"), false);
});

test("v4 an unknown answer stops the observation and cleans only what was attempted", async () => {
  const { report, world } = await run({ faults: { "V4-U-pg-c": { status: 503 } } });
  assert.equal(report.completed, false);
  assert.equal(report.closureReady, false);
  assert.equal(report.cleanupVerified, true);
  assert.equal(world.buckets.has(T), false);
  assert.deepEqual(objectDeletes(world), [
    "tl-d1",
    "tl-d1a",
    "tl-d2a",
    "tl-f",
    "pg-a",
    "pg-b",
    "pg-c",
  ]);
  assert.equal(
    cases(world).some((id) => id.startsWith("V4-L-")),
    false,
  );
});

test("v4 a refused upload is a precondition violation and leaves nothing behind", async () => {
  const { report, world } = await run({
    faults: { "V4-U-gl-a": { status: 403, headers: {}, body: empty() } },
  });
  assert.deepEqual(report.violations, ["V4-U-gl-a"]);
  assert.equal(report.closureReady, false);
  assert.equal(report.cleanupVerified, true);
  assert.equal(world.objects.size, 0);
  assert.equal(objectDeletes(world).includes("gl-ab"), false);
});

test("v4 a refused bucket create never deletes anything", async () => {
  const { report, world } = await run({
    faults: { "V4-W-bucket": { status: 409, headers: {}, body: Buffer.from("{}") } },
  });
  assert.equal(report.completed, false);
  assert.equal(report.closureReady, false);
  assert.equal(
    cases(world).some((id) => id.startsWith("V4-K-del") || id === "V4-K-delete-bucket"),
    false,
  );
  assert.equal(cases(world).includes("V4-K-bucket"), true);
});

test("v4 an unknown bucket create needs its own positive read before cleanup deletes", async () => {
  const unknown = (request, { answer }) => ({ ...answer, status: 503 });
  const { report, world } = await run({
    faults: { "V4-W-bucket": unknown },
    applyBeforeFault: ["V4-W-bucket"],
  });
  assert.equal(report.completed, false);
  assert.equal(cases(world).includes("V4-K-read-created-bucket"), true);
  assert.equal(world.buckets.has(T), false);
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.closureReady, false);
  // An unknown create followed only by a 404 stays unconfirmed and nothing is deleted.
  const absent = await run({ faults: { "V4-W-bucket": { status: 503, body: empty() } } });
  assert.equal(
    cases(absent.world).some((id) => id.startsWith("V4-K-del") || id === "V4-K-delete-bucket"),
    false,
  );
  assert.equal(absent.report.closureReady, false);
  assert.equal(absent.report.unresolved.length, 1);
});

test("v4 an unknown bucket delete is never resent and A2 closes it after a 404", async () => {
  const unknown = (request, { answer }) => ({ ...answer, status: 503 });
  const result = await run({
    faults: { "V4-K-delete-bucket": unknown },
    applyBeforeFault: ["V4-K-delete-bucket"],
  });
  assert.equal(cases(result.world).filter((id) => id === "V4-K-delete-bucket").length, 1);
  assert.equal(result.report.closureReady, false);
  const endedAt = Date.now();
  const previous = [
    {
      phase: "header",
      stage: "v4",
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
  assert.deepEqual(
    entries.filter((e) => e.phase === "before").map((e) => `${e.method} ${e.case}`),
    ["GET V4-A2-bucket", "GET V4-A2-object"],
  );
  // A bucket that still exists keeps the run open, and a v3 journal cannot be read as v4.
  const world = createFakeWorld(target);
  await world.net(plan["V4-W-bucket"]);
  const open = createWire({ target, net: world.net, journal: { append() {} } });
  assert.equal(
    (await readback({ target, client: open, previous, now: () => endedAt + 600_000 })).closureReady,
    false,
  );
  await assert.rejects(
    readback({
      target,
      client: open,
      previous: [{ ...previous[0], stage: "v3" }, ...previous.slice(1)],
      now: () => endedAt + 600_000,
    }),
    /matching completed journal/,
  );
});

test("v4 local rehearsal skips bucket management and verifies the object cleanup", async () => {
  const local = targetOf({ ...identity, runId: "ss-0123abcd", local: "http://127.0.0.1:39199" });
  const { report, world, entries } = await run({}, local);
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, true);
  assert.deepEqual(
    entries.filter((e) => e.phase === "skipped" && e.reason.startsWith("local")).map((e) => e.case),
    ["V4-W-bucket"],
  );
  assert.equal(cases(world).includes("V4-initial-list"), true);
  assert.equal(cases(world).includes("V4-K-delete-bucket"), false);
  assert.equal(cases(world).at(-1), "V4-K-read-object");
  // A non-empty bucket is never written to.
  const dirty = createFakeWorld(local);
  dirty.objects.set("x", { bucket: T, name: "x", size: 1, metadata: {}, acl: [] });
  dirty.buckets.set(T, { name: T });
  const sink = [];
  const client = createWire({
    target: local,
    net: dirty.net,
    journal: { append: (e) => sink.push(e) },
  });
  const refused = await observeV4({ target: local, client });
  assert.equal(refused.violations.includes("V4-initial-list"), true);
  assert.equal(
    dirty.log.some((r) => r.case.startsWith("V4-U-")),
    false,
  );
});

test("v4 a local emulator's 5xx on an observation is recorded and the rehearsal goes on", async () => {
  const local = targetOf({ ...identity, runId: "ss-0123abcd", local: "http://127.0.0.1:39199" });
  const notImplemented = { status: 501, headers: {}, body: Buffer.from("Not Implemented") };
  const { report, world } = await run({ faults: { "V4-X-xml-delete": notImplemented } }, local);
  assert.equal(report.completed, true);
  assert.equal(report.closureReady, false);
  assert.equal(report.cleanupVerified, true);
  assert.equal(cases(world).includes("V4-M-len-8000"), true);
  // Production never goes on past the same answer, and it stops before the later observations.
  const stopped = await run({ faults: { "V4-X-xml-delete": notImplemented } });
  assert.equal(stopped.report.completed, false);
  assert.equal(cases(stopped.world).includes("V4-M-len-8000"), false);
  assert.equal(stopped.report.cleanupVerified, true);
  // Setup and uploads are never tolerated, even locally.
  const upload = await run({ faults: { "V4-U-pg-a": notImplemented } }, local);
  assert.equal(upload.report.completed, false);
  assert.equal(
    cases(upload.world).some((id) => id.startsWith("V4-L-")),
    false,
  );
});

test("v4 request budget refuses the 141st request and v3 keeps its 60", async () => {
  const world = createFakeWorld(target);
  const client = createWire({ target, net: world.net, journal: { append() {} } });
  for (let i = 0; i < V4_BUDGET; i++) await client.wire(plan["V4-P-location"]);
  await assert.rejects(client.wire(plan["V4-P-location"]), /budget exhausted/);
  assert.equal(world.log.length, V4_BUDGET);
  const v3 = targetOf({ ...identity, stage: "v3" });
  const other = createWire({ target: v3, net: world.net, journal: { append() {} } });
  assert.equal(other.budget.limit, 60);
});

test("v4 main runs the fake world, refuses mixed stages and refuses --send without the flag", async () => {
  const directory = mkdtempSync(join(tmpdir(), "strictness-v4-"));
  const args = [
    "v4",
    "--project",
    target.project,
    "--default-bucket",
    target.defaultBucket,
    "--out",
    join(directory, "fake"),
  ];
  const oldFlag = process.env[SEND_FLAG];
  const originalLog = console.log;
  try {
    delete process.env[SEND_FLAG];
    console.log = () => {};
    assert.equal(await main(args), 0);
    const lines = readFileSync(join(directory, "fake", "journal.jsonl"), "utf8")
      .trim()
      .split("\n");
    assert.equal(JSON.parse(lines[0]).stage, "v4");
    assert.equal(JSON.parse(lines.at(-1)).closureReady, true);
    await assert.rejects(main(["v3", ...args]), /invalid arguments/);
    await assert.rejects(main([...args, "v3"]), /invalid arguments/);
    await assert.rejects(
      main([...args.slice(0, -1), join(directory, "send"), "--send"]),
      /production send flag required/,
    );
  } finally {
    console.log = originalLog;
    if (oldFlag === undefined) delete process.env[SEND_FLAG];
    else process.env[SEND_FLAG] = oldFlag;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v4 judge rows state the content of each answer, by names, order and framing", async () => {
  const { entries } = await run();
  const rows = judgeJournal([{ phase: "header", stage: "v4" }, ...entries]);
  const byCase = Object.fromEntries(rows.map((row) => [row.case, row]));
  assert.equal(rows.length, V4_OBSERVATIONS.length + 2);
  assert.deepEqual(byCase["V4-L-itd-true"].v4.items, ["tl/d1/", "tl/f.txt"]);
  assert.deepEqual(byCase["V4-L-itd-true"].v4.prefixes, ["tl/d1/", "tl/d2/"]);
  assert.deepEqual(byCase["V4-L-itd-false"].v4.items, ["tl/f.txt"]);
  assert.equal(byCase["V4-L-itd-p1"].v4.nextPageToken, true);
  assert.equal(byCase["V4-L-itd-p3"].v4.nextPageToken, false);
  assert.deepEqual(byCase["V4-MD-get-up"].v4.metadataKeys, ["zeta", "alpha", "mid"]);
  assert.deepEqual(byCase["V4-MD-patch-delete"].v4.metadataKeys, ["alpha", "mid", "beta"]);
  assert.deepEqual(byCase["V4-MD-patch-plain"].v4.metadataKeys, ["yb", "ya", "yc"]);
  assert.deepEqual(byCase["V4-MD-list"].v4.itemMetadataKeys["md/up.txt"], ["alpha", "mid", "beta"]);
  assert.equal(byCase["V4-X-acl-delete"].shape, "empty");
  assert.equal(byCase["V4-X-acl-delete"].v4.contentLength, "0");
  assert.equal(byCase["V4-X-xml-delete"].v4.contentLength, null);
  assert.equal(byCase["V4-X-xml-delete-again"].shape, "xml-error");
  assert.equal(byCase["V4-N-get"].json.code, 412);
  assert.equal(byCase["V4-M-len-1025"].status, 400);
  assert.equal(byCase["V4-L-itd-p4"].known, false);
  assert.equal(byCase["V4-L-itd-p4"].shape, "unrecorded");
  assert.equal(byCase["V4-W-verify"].shape, "bucket-resource");
  for (const id of V4_OBSERVATIONS)
    if (id !== "V4-L-itd-p4") assert.equal(byCase[id].known, true, id);
});

test("v4 judge rows hide generated values but never member order or framing", () => {
  const object = (extra = {}, metadata = { a: "1", b: "2" }) => ({
    kind: "storage#object",
    name: "x",
    bucket: "b",
    generation: "1",
    etag: "CAE=",
    metadata,
    ...extra,
  });
  const facts = (value, headers = { "content-length": "5" }) =>
    v4Facts({ case: "V4-MD-get-up" }, Buffer.from(JSON.stringify(value)), headers);
  const random = prng(3);
  for (let i = 0; i < 100; i++) {
    const noise = { generation: String(Math.floor(random() * 1e9)), etag: `E${random()}` };
    assert.deepEqual(facts(object(noise)), facts(object()));
  }
  assert.notDeepEqual(facts(object({}, { b: "2", a: "1" })), facts(object()));
  assert.notDeepEqual(facts(object(), { "content-length": "6" }), facts(object()));
  assert.notDeepEqual(facts(object(), {}), facts(object()));
  const bucket = (extra) => ({
    kind: "storage#bucket",
    name: "n",
    projectNumber: "1",
    etag: "CAE=",
    location: "US",
    ...extra,
  });
  assert.deepEqual(facts(bucket({ projectNumber: "2" })).facts.members.projectNumber, "<string:1>");
  assert.notDeepEqual(facts(bucket({ location: "EU" })), facts(bucket({})));
  assert.notDeepEqual(
    facts(bucket({ etag: "CAE=" })).facts.members.etag,
    facts(bucket({ etag: "CAEAA" })).facts.members.etag,
  );
});

test("v4 comparison reports a difference in order, framing or listing and nothing else", async () => {
  const { entries } = await run();
  const production = judgeJournal([{ phase: "header", stage: "v4" }, ...entries]);
  const same = structuredClone(production);
  assert.ok(
    compare(production, same).every((row) => row.verdict === "MATCH" || row.case === "V4-L-itd-p4"),
  );
  const changed = structuredClone(production);
  const at = (id) => changed.find((row) => row.case === id);
  at("V4-MD-get-up").v4.metadataKeys.reverse();
  at("V4-X-acl-delete").v4.contentLength = null;
  at("V4-L-itd-true").v4.items.pop();
  const verdict = Object.fromEntries(
    compare(production, changed).map((row) => [row.case, row.verdict]),
  );
  assert.equal(verdict["V4-MD-get-up"], "DIFFERS(v4)");
  assert.equal(verdict["V4-X-acl-delete"], "DIFFERS(v4)");
  assert.equal(verdict["V4-L-itd-true"], "DIFFERS(v4)");
  assert.equal(verdict["V4-L-delim"], "MATCH");
});

test("v4 glob reference parser rejects exactly the unterminated and oversized patterns", () => {
  for (const pattern of ["gl/[a", "gl/{a,b", "gl/a\\", `gl/${"a".repeat(1022)}`, "}"])
    assert.ok(globRegex(pattern).error, pattern);
  for (const pattern of ["", "gl/*", "gl/**", nest(32), `gl/${"a".repeat(1021)}`])
    assert.ok(globRegex(pattern).regex, pattern);
  assert.ok(globRegex("gl/{a,ab}.txt").regex.test("gl/ab.txt"));
});

test("v4 closure needs no unresolved resource: settlement ignores objects and tracks the bucket", async () => {
  const { entries } = await run();
  assert.deepEqual(settlement(entries).unresolved, []);
  const bucketRows = entries.filter(
    (e) => e.phase === "before" && e.resource === `/storage/v1/b/${T}`,
  );
  assert.deepEqual(
    bucketRows
      .map((e) => e.case)
      .filter((id) => id.includes("W-bucket") || id.includes("delete-bucket")),
    ["V4-W-bucket", "V4-K-delete-bucket"],
  );
  assert.equal(entries.filter((e) => e.resource && e.case.startsWith("V4-U-")).length, 0);
});

// Pairwise table from PICT (model: Mode, Group, Fault, Applied; 51 rows, six required rows seeded).
const FAULT_GROUPS = {
  "bucket-create": "V4-W-bucket",
  "upload-first": "V4-U-tl-d1",
  "upload-last": "V4-U-md-up",
  listing: "V4-L-delim",
  "token-page": "V4-L-itd-p2",
  "delete-mid": "V4-G-del-b",
  patch: "V4-MD-patch-add",
  copy: "V4-MD-copy",
  xml: "V4-X-xml-delete",
  acl: "V4-X-acl-insert",
  "bucket-patch": "V4-B-patch",
  nonfirebase: "V4-N-get",
  "glob-first": "V4-M-ctl",
  "glob-last": "V4-M-len-8000",
  "cleanup-object-delete": "V4-K-del-tl-d1",
  "cleanup-bucket-delete": "V4-K-delete-bucket",
  "final-read": "V4-K-bucket",
};
const FAULT_ROWS = [
  ["production", "bucket-create", "unknown", "yes"],
  ["production", "cleanup-bucket-delete", "unknown", "yes"],
  ["production", "upload-last", "transport", "no"],
  ["local", "glob-last", "unknown", "yes"],
  ["production", "final-read", "unknown", "no"],
  ["production", "token-page", "known-4xx", "yes"],
  ["local", "listing", "transport", "yes"],
  ["local", "token-page", "unknown", "no"],
  ["local", "acl", "known-4xx", "no"],
  ["production", "delete-mid", "unknown", "no"],
  ["production", "acl", "transport", "yes"],
  ["local", "upload-last", "unknown", "yes"],
  ["local", "bucket-patch", "transport", "no"],
  ["local", "final-read", "transport", "yes"],
  ["local", "upload-last", "known-4xx", "no"],
  ["production", "listing", "unknown", "no"],
  ["production", "nonfirebase", "known-4xx", "yes"],
  ["local", "delete-mid", "transport", "yes"],
  ["local", "cleanup-object-delete", "transport", "yes"],
  ["local", "bucket-create", "known-4xx", "no"],
  ["production", "patch", "transport", "no"],
  ["production", "glob-last", "known-4xx", "no"],
  ["production", "bucket-patch", "unknown", "yes"],
  ["production", "xml", "known-4xx", "no"],
  ["local", "glob-first", "known-4xx", "no"],
  ["production", "cleanup-object-delete", "known-4xx", "no"],
  ["local", "bucket-create", "transport", "no"],
  ["local", "copy", "known-4xx", "yes"],
  ["local", "nonfirebase", "transport", "no"],
  ["production", "copy", "unknown", "no"],
  ["local", "bucket-patch", "known-4xx", "yes"],
  ["production", "acl", "unknown", "no"],
  ["local", "patch", "unknown", "yes"],
  ["production", "upload-first", "unknown", "yes"],
  ["local", "cleanup-bucket-delete", "transport", "no"],
  ["local", "nonfirebase", "unknown", "yes"],
  ["production", "glob-first", "unknown", "yes"],
  ["production", "delete-mid", "known-4xx", "yes"],
  ["local", "xml", "unknown", "yes"],
  ["local", "cleanup-bucket-delete", "known-4xx", "yes"],
  ["local", "token-page", "transport", "yes"],
  ["production", "glob-last", "transport", "yes"],
  ["production", "glob-first", "transport", "yes"],
  ["local", "upload-first", "transport", "no"],
  ["production", "final-read", "known-4xx", "yes"],
  ["production", "copy", "transport", "no"],
  ["production", "upload-first", "known-4xx", "no"],
  ["production", "xml", "transport", "yes"],
  ["local", "cleanup-object-delete", "unknown", "no"],
  ["production", "patch", "known-4xx", "yes"],
  ["production", "listing", "known-4xx", "yes"],
];
const FAULTS = {
  unknown: (applied) =>
    applied ? (request, { answer }) => ({ ...answer, status: 503 }) : { status: 503 },
  transport: () => "transport",
  "known-4xx": (applied) =>
    applied
      ? (request, { answer }) => ({ ...answer, status: 403 })
      : { status: 403, headers: {}, body: Buffer.from("{}") },
};

test("v4 invariants hold under each pairwise fault combination", async () => {
  const local = targetOf({ ...identity, runId: "ss-0123abcd", local: "http://127.0.0.1:39199" });
  for (const [mode, group, fault, applied] of FAULT_ROWS) {
    const id = FAULT_GROUPS[group];
    const label = `${mode} ${group} ${fault} applied=${applied}`;
    const runTarget = mode === "local" ? local : target;
    const result = await run(
      {
        faults: { [id]: FAULTS[fault](applied === "yes") },
        applyBeforeFault: applied === "yes" ? [id] : [],
      },
      runTarget,
    );
    const sent = cases(result.world);
    const uploaded = new Set(sent.filter((c) => c.startsWith("V4-U-")).map((c) => c.slice(5)));
    if (sent.includes("V4-MD-copy")) uploaded.add("md-copy");
    for (const key of objectDeletes(result.world)) assert.ok(uploaded.has(key), `${label} ${key}`);
    const bucketDeletes = sent.filter((c) => c === "V4-K-delete-bucket").length;
    assert.ok(bucketDeletes <= 1, label);
    const answered = (c) => result.entries.find((e) => e.phase === "after" && e.case === c);
    const created = answered("V4-W-bucket");
    const confirmed =
      (created && created.status >= 200 && created.status < 300 && !created.unknown) ||
      answered("V4-K-read-created-bucket")?.showsResource;
    if (mode === "production" && bucketDeletes) assert.ok(confirmed, label);
    if (mode === "production" && sent.some((c) => c.startsWith("V4-K-del-")))
      assert.ok(confirmed, label);
    const unknown = result.entries.some((e) => e.phase === "after" && e.unknown);
    if (result.report.closureReady) {
      assert.equal(result.report.cleanupVerified, true, label);
      assert.equal(unknown, false, label);
      assert.equal(result.world.buckets.has(T), mode === "local", label);
      assert.equal(result.world.objects.size, 0, label);
    }
    assert.ok(result.report.requests <= V4_BUDGET, label);
    // Production stops observing at the first unknown or violating answer: only cleanup follows.
    if (mode === "production") {
      const firstBad = result.entries.findIndex(
        (e) =>
          e.phase === "after" &&
          (e.unknown || e.case === id) &&
          (e.unknown || fault !== "known-4xx"),
      );
      if (firstBad >= 0 && result.report.completed === false) {
        const later = result.entries
          .slice(firstBad + 1)
          .filter((e) => e.phase === "before")
          .map((e) => e.case);
        assert.ok(
          later.every((c) => c.startsWith("V4-K-")),
          `${label} ${later}`,
        );
      }
    }
    // A cleanup that deletes the bucket leaves nothing but the default bucket in production.
    if (mode === "production")
      assert.equal(result.world.buckets.has(target.defaultBucket), true, label);
  }
});
