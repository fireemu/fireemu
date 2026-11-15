import "../storage-signed-put/test-preload.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { judgeAnswer, judgeJournal, parseXmlError, settlement } from "./judge.mjs";
import { compare } from "./compare.mjs";

const answer = (body, extra = {}) => {
  const bytes = Buffer.from(body);
  return {
    case: "P2",
    method: "GET",
    status: 404,
    bodyBase64: bytes.toString("base64"),
    bodyBytes: bytes.length,
    headers: {},
    ...extra,
  };
};

// shape-from-code: signed-put's judge tests and fixtures contain neither of these recordings.
// storage.rs missing_bucket_response and api_error::gcs specify this envelope; this is not a production capture.
const missing =
  '{"error":{"code":404,"message":"The specified bucket does not exist.","errors":[{"domain":"global","reason":"notFound","message":"The specified bucket does not exist."}]}}';

test("shape-from-code: missing bucket JSON preserves exact bytes and extracts the GCS error", () => {
  const row = judgeAnswer(answer(missing));
  assert.deepEqual(row.json, {
    code: 404,
    message: "The specified bucket does not exist.",
    reason: "notFound",
  });
  assert.equal(row.bodyBytes, Buffer.byteLength(missing));
  assert.equal(row.sha256, createHash("sha256").update(missing).digest("hex"));
  assert.equal(row.known, true);
});

test("shape-from-code: unconfigured bucket OPTIONS is 200 with no Access-Control headers", () => {
  // storage_cors.rs documents the recorded status and absence of CORS headers, but no full header capture.
  const row = judgeAnswer(answer("", { case: "R3", method: "OPTIONS", status: 200, headers: {} }));
  assert.equal(row.shape, "empty");
  assert.equal(row.known, true);
  assert.deepEqual(row.headers, {});
  assert.equal(row.bodyBytes, 0);
});

test("body layout is based on recorded bytes and digest, never reserialized JSON", () => {
  const pretty = JSON.stringify(JSON.parse(missing), null, 2) + "\n";
  const a = judgeAnswer(answer(missing));
  const b = judgeAnswer(answer(pretty));
  assert.deepEqual(a.json, b.json);
  assert.notEqual(a.bodyBytes, b.bodyBytes);
  assert.equal(compare([a], [b])[0].verdict, "MATCH");
  assert.equal(judgeAnswer(answer(missing, { bodyBytes: 1 })).known, false);
  assert.equal(judgeAnswer(answer("日本", { bodyBytes: 2 })).known, false);
});

test("documented XML errors need a complete Error document and Code and Message", () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist.</Message></Error>';
  assert.deepEqual(judgeAnswer(answer(xml)).xml, {
    Code: "NoSuchBucket",
    Message: "The specified bucket does not exist.",
  });
  assert.deepEqual(
    parseXmlError("<Error><Code>NoSuchBucket</Code><Message>a &amp; b</Message></Error>"),
    { Code: "NoSuchBucket", Message: "a & b" },
  );
  for (const value of [
    "<Error/>",
    "<Error><Code>X</Code></Error>",
    `<html>${xml}</html>`,
    `${xml}junk`,
    '<!DOCTYPE Error SYSTEM "file:///etc/passwd">' + xml,
    "<Error><Code>X</Code><Code>Y</Code><Message>m</Message></Error>",
    "<Error><Code>X</Code><Message>&unknown;</Message></Error>",
    "<Error><Code>X</Code><Message>m</Message><Unknown>x</Unknown></Error>",
  ])
    assert.equal(parseXmlError(value), null);
});

test("unknown, unrecorded, missing and duplicate cases are never accepted", () => {
  const row = judgeAnswer(answer(missing));
  assert.equal(compare([row], [row])[0].verdict, "MATCH");
  for (const value of [
    answer("html"),
    answer('{"unexpected":true}'),
    answer('{"error":{"code":404,"message":"m","extra":true}}'),
    answer(missing, { unknown: true }),
    answer(missing, { status: 503 }),
    answer(missing, { withheld: true }),
  ]) {
    const unknown = judgeAnswer(value);
    assert.equal(unknown.known, false);
    assert.equal(compare([unknown], [unknown])[0].verdict, "NEEDS-REVIEW");
  }
  assert.equal(compare([row], [])[0].verdict, "NEEDS-REVIEW");
  assert.equal(compare([row, row], [row])[0].verdict, "NEEDS-REVIEW");
  assert.equal(compare([], [row])[0].verdict, "NEEDS-REVIEW");
  const interrupted = judgeJournal([{ phase: "before", n: 1, case: "W1", method: "POST" }]);
  assert.equal(interrupted[0].known, false);
});

test("seeded header extraction keeps all names sorted and exact selected values", () => {
  let seed = 0xc0ffee;
  const names = [
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Headers",
    "Access-Control-Max-Age",
    "Access-Control-Expose-Headers",
    "Vary",
    "Content-Length",
    "Date",
    "ETag",
    "X-Custom",
  ];
  for (let i = 0; i < 200; i++) {
    const headers = {};
    for (const name of names) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if ((seed >>> 16) & 1)
        headers[(seed >>> 17) & 1 ? name.toUpperCase() : name] = String(seed % 1000);
    }
    const row = judgeAnswer(answer(missing, { headers }));
    const expectedNames = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .filter((name) => name.startsWith("access-control-") || ["vary", "location"].includes(name))
      .toSorted();
    assert.deepEqual(row.headerNames, expectedNames);
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      assert.equal(
        row.headers[lower],
        lower.startsWith("access-control-") || lower === "vary" ? value : undefined,
      );
    }
  }
});

test("transport Content-Length is not a stable CORS comparison", () => {
  const a = judgeAnswer(answer("", { case: "F2", method: "DELETE", status: 204 }));
  const b = judgeAnswer(
    answer("", { case: "F2", method: "DELETE", status: 204, headers: { "Content-Length": "0" } }),
  );
  assert.equal(compare([a], [b])[0].verdict, "MATCH");
});

test("JSON error recognition requires each recorded layout constraint", () => {
  const valid = { error: { code: 400, message: "bad", errors: [{ reason: "invalid" }] } };
  const row = (value, status = 400) => judgeAnswer(answer(JSON.stringify(value), { status }));
  assert.equal(row(valid).shape, "json-error");
  for (const [value, status] of [
    [{ ...valid, extra: true }, 400],
    [{ error: { ...valid.error, extra: true } }, 400],
    [{ error: { ...valid.error, code: 399 } }, 399],
    [{ error: { ...valid.error, code: 500 } }, 500],
    [{ error: { ...valid.error, code: 400.5 } }, 400],
    [valid, 401],
    [{ error: { ...valid.error, message: 1 } }, 400],
    [{ error: { ...valid.error, errors: [] } }, 400],
    [{ error: { ...valid.error, errors: {} } }, 400],
    [{ error: { ...valid.error, errors: [null] } }, 400],
    [{ error: { ...valid.error, errors: [{}] } }, 400],
    [{ error: { ...valid.error, errors: [{ reason: "x", extra: true }] } }, 400],
  ])
    assert.equal(row(value, status).shape, "unrecorded", JSON.stringify(value));
  assert.deepEqual(row({ error: {} }).json, { code: null, message: null, reason: null });
  assert.equal(row({ error: { code: 499, message: "x" } }, 499).shape, "json-error");
});

test("recorded shapes and byte metadata require exact boundaries", () => {
  const xml = "<Error><Code>X</Code><Message>m</Message></Error>";
  for (const status of [399, 500])
    assert.equal(judgeAnswer(answer(xml, { status })).shape, "unrecorded");
  for (const status of [400, 499])
    assert.equal(judgeAnswer(answer(xml, { status })).shape, "xml-error");
  for (const [method, status, shape] of [
    ["OPTIONS", 200, "empty"],
    ["OPTIONS", 201, "unrecorded"],
    ["DELETE", 204, "empty"],
    ["GET", 204, "unrecorded"],
  ])
    assert.equal(judgeAnswer(answer("", { method, status })).shape, shape);
  for (const [id, status, shape] of [
    ["C5", 200, "media"],
    ["C6", 200, "media"],
    ["C5", 201, "unrecorded"],
    ["P2", 200, "unrecorded"],
  ])
    assert.equal(judgeAnswer(answer("fire", { case: id, status })).shape, shape);
  for (const extra of [
    { headersRedacted: true },
    { bodyBytes: null },
    { bodyBytes: 4.5 },
    { bodyBase64: "ZmlyZQ" },
  ])
    assert.equal(judgeAnswer(answer("fire", { case: "C5", status: 200, ...extra })).known, false);
});

test("settlement retains exact ownership and uncertainty state across reads", () => {
  const e = (action, status, extra = {}) => ({
    phase: "after",
    resource: "r",
    action,
    status,
    ...extra,
  });
  const state = (...entries) => settlement(entries).unresolved[0];
  assert.deepEqual(settlement([e("read", 200, { showsResource: true })]), {
    closureReady: true,
    unresolved: [],
  });
  assert.equal(state(e("create", 200), e("delete", 503), e("read", 404)).unknownDelete, true);
  assert.equal(
    state(e("create", 503), e("read", 200, { showsResource: true })).unknownCreate,
    false,
  );
  assert.equal(state(e("create", 200), e("delete", 204), e("create", 503)).deleted, false);
  assert.equal(
    state(e("create", 200), e("delete", 204), e("read", 200, { showsResource: true })).deleted,
    false,
  );
  assert.equal(
    state(e("create", 200), e("delete", 503), e("read", 404, { session: "a2" })),
    undefined,
  );
  assert.equal(
    settlement([
      { phase: "before", n: 1, resource: "r", action: "create" },
      { ...e("create", 409), n: 1 },
    ]).closureReady,
    true,
  );
  assert.equal(
    settlement([{ phase: "other", resource: "r", action: "create" }]).closureReady,
    true,
  );
  assert.equal(settlement([e("create", 200, { resource: "" }), e("", 200)]).closureReady, true);
});

test("comparison rejects a single unknown row on either side", () => {
  const row = judgeAnswer(answer(missing));
  const unknown = { ...row, known: false };
  assert.equal(compare([row], [unknown])[0].verdict, "NEEDS-REVIEW");
  assert.equal(compare([unknown], [row])[0].verdict, "NEEDS-REVIEW");
  assert.equal(compare([row], [row, row])[0].verdict, "NEEDS-REVIEW");
});

test("settlement records independent creation and deletion evidence", () => {
  const event = (action, status, extra = {}) => ({
    phase: "after",
    resource: "r",
    action,
    status,
    ...extra,
  });
  const only = (...events) => settlement(events).unresolved[0];
  assert.deepEqual(only(event("create", 503)), {
    resource: "r",
    confirmed: false,
    unknownCreate: true,
    unknownDelete: false,
    deleted: false,
    absent: false,
    reason: "unconfirmed create",
  });
  assert.deepEqual(only(event("delete", 503)), {
    resource: "r",
    confirmed: false,
    unknownCreate: false,
    unknownDelete: true,
    deleted: false,
    absent: false,
    reason: "unknown delete",
  });
  assert.deepEqual(only(event("create", 200)), {
    resource: "r",
    confirmed: true,
    unknownCreate: false,
    unknownDelete: false,
    deleted: false,
    absent: false,
    reason: "created, not deleted and read back absent",
  });
  assert.equal(only(event("create", 200), event("delete", 204)).deleted, true);
  assert.equal(
    only(event("create", 200), event("read", 404, { session: "a2" }), event("create", 200)).absent,
    false,
  );
  assert.equal(
    only(event("create", 200), event("read", 404, { session: "a2" }), event("delete", 503)).absent,
    false,
  );
  assert.equal(
    only(event("create", 200), event("read", 404, { session: "a2" }), event("delete", 204)).absent,
    false,
  );
  assert.equal(
    only(event("create", 503), event("read", 404, { session: "a2" })).unknownCreate,
    true,
  );
  assert.equal(only(event("create", 200), event("delete", 503), event("read", 404)).absent, false);
  assert.equal(only(event("create", 200), event("read", 200)).confirmed, true);
  assert.equal(
    only(event("create", 503), event("read", 503, { showsResource: true })).unknownCreate,
    true,
  );
});

test("row extraction preserves null fields and exact media byte layout", () => {
  const row = judgeAnswer(answer(JSON.stringify({ error: { code: 404, message: "missing" } })));
  assert.deepEqual(row.json, { code: 404, message: "missing", reason: null });
  assert.equal(row.xml, null);
  const media = judgeAnswer(answer("fire", { case: "C5", status: 200 }));
  assert.equal(media.json, null);
  assert.equal(media.xml, null);
  assert.equal(media.bodyBytes, 4);
  assert.equal(media.known, true);
  for (const extra of [{ bodyBytes: 0 }, { bodyBytes: 5 }, { bodyBase64: "ZmlyZQ==\n" }])
    assert.equal(judgeAnswer(answer("fire", { case: "C5", status: 200, ...extra })).known, false);
  for (const body of ["fir", "fires", "Fire"])
    assert.equal(judgeAnswer(answer(body, { case: "C5", status: 200 })).shape, "unrecorded");
});

test("comparison command succeeds only for a nonempty set of matches", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "strictness-compare-"));
  try {
    const production = join(dir, "production.json");
    const journal = join(dir, "journal.jsonl");
    const before = { phase: "before", n: 1, case: "C5", method: "GET" };
    const after = { ...answer("fire", { case: "C5", status: 200 }), phase: "after", n: 1 };
    const invoke = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL("./compare.mjs", import.meta.url)), production, journal],
        { encoding: "utf8" },
      );
    writeFileSync(journal, [before, after].map(JSON.stringify).join("\n") + "\n");
    writeFileSync(production, JSON.stringify([judgeAnswer(after)]));
    assert.equal(invoke().status, 0);
    writeFileSync(production, JSON.stringify([{ ...judgeAnswer(after), status: 201 }]));
    assert.equal(invoke().status, 1);
    writeFileSync(production, "[]");
    writeFileSync(journal, "\n");
    assert.equal(invoke().status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each unknown signal alone makes a create unconfirmed: a before-only entry, an unknown flag, an unknown status", () => {
  const r = "/storage/v1/b/fireemu-obs-ss-00000000";
  const cases = [
    [{ phase: "before", n: 1, action: "create", resource: r }],
    [{ phase: "after", n: 1, action: "create", resource: r, status: 200, unknown: true }],
    [{ phase: "after", n: 1, action: "create", resource: r, status: 503 }],
    [{ phase: "after", n: 1, action: "create", resource: r, status: 302 }],
  ];
  for (const entries of cases) {
    const reasons = settlement(entries).unresolved.map((s) => s.reason);
    assert.deepEqual(reasons, ["unconfirmed create"], JSON.stringify(entries));
  }
});

test("an A2 read that answers 200 without the resource never settles a confirmed create as absent", () => {
  const r = "/storage/v1/b/fireemu-obs-ss-00000000";
  const entries = [
    { phase: "after", n: 1, action: "create", resource: r, status: 200 },
    {
      phase: "after",
      n: 1,
      session: "a2",
      action: "read",
      resource: r,
      status: 200,
      showsResource: false,
    },
  ];
  assert.equal(settlement(entries).unresolved.length, 1);
  entries[1] = { ...entries[1], status: 404 };
  assert.equal(settlement(entries).unresolved.length, 0);
});

test("v3 CORS rows compare stable shapes and relevant headers, including Location", async () => {
  const { targetOf, requests } = await import("./guard.mjs");
  const { createFakeWorld } = await import("./world.fake.mjs");
  const { createWire } = await import("./wire.mjs");
  const { observe } = await import("./run.mjs");
  const target = targetOf({
    project: "fireemu-oracle-query",
    defaultBucket: "fireemu-oracle-query.firebasestorage.app",
    runId: "ss-1234abcd",
    stage: "v3",
  });
  const entries = [{ phase: "header", stage: "v3" }];
  const client = createWire({
    target,
    net: createFakeWorld(target).net,
    journal: { append: (entry) => entries.push(entry) },
  });
  await observe({ target, client });
  const rows = judgeJournal(entries);
  assert.equal(rows.length, 27);
  assert.ok(rows.every((row) => row.known));
  assert.ok(compare(rows, rows).every((row) => row.verdict === "MATCH"));
  const id = "V3-configured-resumable";
  const start = entries.find((entry) => entry.phase === "after" && entry.case === id);
  const startRow = rows.find((row) => row.case === id);
  assert.equal(startRow.exposesLocation, true);
  assert.ok(startRow.headerNames.includes("location"));
  assert.equal(startRow.headers.location, undefined);
  const changed = judgeAnswer({
    ...start,
    headers: {
      ...start.headers,
      location: entries.find(
        (entry) => entry.phase === "before" && entry.case === "V3-configured-cancel",
      ).url,
      "access-control-expose-headers": "Content-Type, Xocation",
    },
  });
  assert.equal(changed.exposesLocation, false);
  assert.equal(compare([startRow], [changed])[0].verdict, "DIFFERS(headers)");
  const media = entries.find((entry) => entry.phase === "after" && entry.case === "V3-empty-media");
  assert.equal(
    judgeAnswer({ ...media, bodyBase64: Buffer.from("fake").toString("base64") }).known,
    false,
  );
  const metadata = entries.find(
    (entry) => entry.phase === "after" && entry.case === "V3-empty-metadata",
  );
  const body = JSON.parse(Buffer.from(metadata.bodyBase64, "base64"));
  const changedBody = Buffer.from(JSON.stringify({ ...body, size: "5" }));
  const different = judgeAnswer({
    ...metadata,
    bodyBase64: changedBody.toString("base64"),
    bodyBytes: changedBody.length,
  });
  assert.equal(compare([judgeAnswer(metadata)], [different])[0].verdict, "MATCH");
  const missingRows = judgeJournal(entries.filter((entry) => entry.case !== id));
  assert.equal(missingRows.find((row) => row.case === id).known, false);
  const duplicate = judgeJournal([
    ...entries,
    { ...start, n: 999 },
    { ...requests(target)[id], phase: "before", n: 999 },
  ]);
  assert.equal(compare(rows, duplicate).find((row) => row.case === id).verdict, "NEEDS-REVIEW");
});

test("v3 shapes enforce endpoint, method, status and resource fields independently", () => {
  const object = { bucket: "b", name: "cors/o.txt", size: "4" };
  const bucket = { name: "b", location: "US" };
  const acl = { bucket: "b", object: "cors/o.txt", entity: "user-a", role: "READER" };
  const cases = [];
  for (const [endpoint, value, shape] of [
    ["metadata", object, "object-metadata"],
    ["bucket", bucket, "bucket-metadata"],
    ["list", { items: [object] }, "object-list"],
    ["acl", { items: [acl] }, "object-acl"],
  ]) {
    cases.push([endpoint, value, shape]);
    for (const method of ["POST", "DELETE"])
      cases.push([endpoint, value, "unrecorded", { method }]);
    for (const status of [201, 400]) cases.push([endpoint, value, "unrecorded", { status }]);
    for (const other of ["metadata", "bucket", "list", "acl", "media", "preflight"])
      if (other !== endpoint) cases.push([other, value, "unrecorded"]);
    cases.push([endpoint, { ...value, error: {} }, "unrecorded"]);
    for (const invalid of [null, [], 0, false, "text"])
      cases.push([endpoint, invalid, "unrecorded"]);
  }
  for (const invalid of [
    {},
    { ...object, bucket: "other" },
    { ...object, name: "other" },
    { ...object, size: "4x" },
    { ...object, size: null },
    { ...object, size: undefined },
  ]) {
    cases.push(["metadata", invalid, "unrecorded"]);
    cases.push(["list", { items: [invalid] }, "unrecorded"]);
  }
  for (const invalid of [null, [], "text", 4])
    cases.push(["list", { items: [invalid] }, "unrecorded"]);
  for (const invalid of [{ ...bucket, name: "other" }, { name: "b" }, { ...bucket, location: 1 }])
    cases.push(["bucket", invalid, "unrecorded"]);
  for (const invalid of [
    {},
    { items: [] },
    { items: [object, object] },
    { items: [object], nextPageToken: "next" },
    { items: {} },
  ])
    cases.push(["list", invalid, "unrecorded"]);
  for (const invalid of [{}, { items: [] }, { items: {} }])
    cases.push(["acl", invalid, "unrecorded"]);
  for (const invalid of [
    null,
    {},
    { ...acl, bucket: "other" },
    { ...acl, object: "other" },
    { ...acl, entity: 1 },
    { ...acl, role: 1 },
  ])
    cases.push(["acl", { items: [invalid] }, "unrecorded"]);
  for (const [endpoint, value, shape, extra = {}] of cases) {
    const row = judgeAnswer(
      answer(JSON.stringify(value), {
        case: `V3-absent-${endpoint}`,
        status: 200,
        method: "GET",
        url: "https://storage.googleapis.com/storage/v1/b/b/o",
        ...extra,
      }),
    );
    assert.equal(row.shape, shape, JSON.stringify({ endpoint, value, extra }));
    assert.equal(row.known, shape !== "unrecorded");
    assert.equal(Object.hasOwn(row, "exposesLocation"), endpoint === "resumable");
  }
});

test("v3 media and resumable shapes require every recorded discriminator", () => {
  for (const method of ["POST", "PUT"])
    assert.equal(
      judgeAnswer(answer("fire", { case: "V3-absent-media", method, status: 200 })).shape,
      "unrecorded",
    );
  const start = {
    case: "V3-absent-resumable",
    method: "POST",
    status: 200,
    url: "https://storage.googleapis.com/upload/storage/v1/b/b/o?uploadType=resumable&name=o",
    headers: {
      location:
        "https://storage.googleapis.com/upload/storage/v1/b/b/o?uploadType=resumable&name=o&upload_id=first",
    },
  };
  assert.equal(judgeAnswer(answer("", start)).shape, "resumable-start");
  for (const extra of [
    { headers: {} },
    ...[
      "<masked>",
      "https://other.example/upload/storage/v1/b/b/o?uploadType=resumable&name=o&upload_id=first",
      "https://storage.googleapis.com/wrong?uploadType=resumable&name=o&upload_id=first",
      start.url,
      `${start.url}&upload_id=`,
      `${start.url}&upload_id=first&upload_id=second`,
      `${start.url}&upload_id=first&unexpected=1`,
      `${start.url.replace("resumable", "media")}&upload_id=first`,
      `${start.url.replace("name=o", "name=other")}&upload_id=first`,
      `${start.url}&upload_id=first#fragment`,
    ].map((location) => ({ headers: { location } })),
    { method: "GET" },
    { status: 201 },
    { case: "V3-absent-preflight" },
  ])
    assert.equal(judgeAnswer(answer("", { ...start, ...extra })).shape, "unrecorded");
  assert.equal(judgeAnswer(answer("x", start)).shape, "unrecorded");
  const row = judgeAnswer(answer("", start));
  const volatile = judgeAnswer(
    answer("", {
      ...start,
      headers: { location: start.headers.location.replace("first", "second") },
    }),
  );
  assert.equal(compare([row], [volatile])[0].verdict, "MATCH");
  assert.equal(
    compare([row], [{ ...row, location: { ...row.location, path: "/other" } }])[0].verdict,
    "DIFFERS(location)",
  );
  assert.notEqual(
    compare([row], [judgeAnswer(answer("", { ...start, headers: { location: "invalid" } }))])[0]
      .verdict,
    "MATCH",
  );
});

test("interrupted journals retain zero-byte unknown placeholders", () => {
  for (const prefix of [[], [{ phase: "header", stage: "v3" }]]) {
    const id = prefix.length ? "V3-absent-preflight" : "R3";
    const rows = judgeJournal([...prefix, { phase: "before", n: 1, case: id, method: "OPTIONS" }]);
    const row = rows.find((candidate) => candidate.case === id);
    assert.equal(row.bodyBytes, 0);
    assert.equal(row.status, null);
    assert.equal(row.known, false);
  }
});

test("masked v3 recording passes the existing publication guard and covers every response", async () => {
  const { readFileSync } = await import("node:fs");
  const { scanFixtureText } = await import("../storage-object-compare/scan.mjs");
  const text = readFileSync(
    new URL("../../storage-strictness-obs/recordings/run-2.json", import.meta.url),
    "utf8",
  );
  scanFixtureText(text);
  const fixture = JSON.parse(text);
  assert.equal(fixture.rows.length, 27);
  assert.equal(new Set(fixture.rows.map((row) => row.case)).size, 27);
  for (const row of fixture.rows) {
    assert.ok(!Object.hasOwn(row, "bodyBase64"));
    assert.ok(!Object.hasOwn(row, "sha256"));
  }
});

test("comparison rejects changed status, CORS names, values and JSON shape while ignoring volatile diagnostics", () => {
  const row = judgeAnswer(
    answer(missing, { headers: { "access-control-allow-origin": "http://localhost:3000" } }),
  );
  for (const changed of [
    { ...row, status: 400 },
    { ...row, shape: "object-list" },
    { ...row, headerNames: [] },
    { ...row, headers: {} },
  ])
    assert.match(compare([row], [changed])[0].verdict, /^DIFFERS/);
  assert.equal(
    compare([row], [{ ...row, bodyBytes: 999, sha256: "different" }])[0].verdict,
    "MATCH",
  );
});

test("comparison retains the recorded ACL error code, message and reason", async () => {
  const { readFileSync } = await import("node:fs");
  const recording = JSON.parse(
    readFileSync(
      new URL("../../storage-strictness-obs/recordings/run-2.json", import.meta.url),
      "utf8",
    ),
  );
  const recorded = recording.rows.find((row) => row.case === "V3-absent-acl");
  const row = judgeAnswer(answer(recorded.body, { case: recorded.case, status: recorded.status }));
  for (const field of ["code", "message", "reason"]) {
    assert.equal(
      compare([row], [{ ...row, json: { ...row.json, [field]: "changed" } }])[0].verdict,
      "DIFFERS(json)",
    );
  }
  const body = JSON.parse(recorded.body);
  body.error.message = "changed ACL message";
  const changed = judgeAnswer(
    answer(JSON.stringify(body), { case: recorded.case, status: recorded.status }),
  );
  assert.equal(changed.known, true);
  assert.equal(compare([row], [changed])[0].verdict, "DIFFERS(json)");
  const xml = judgeAnswer(
    answer("<Error><Code>NoSuchBucket</Code><Message>missing</Message></Error>"),
  );
  assert.equal(
    compare([xml], [{ ...xml, xml: { ...xml.xml, Message: "changed" } }])[0].verdict,
    "DIFFERS(xml)",
  );
});

const fixtureRows = async () => {
  const { readFileSync } = await import("node:fs");
  return JSON.parse(
    readFileSync(
      new URL("../../storage-strictness-obs/recordings/run-2.json", import.meta.url),
      "utf8",
    ),
  ).rows;
};

// Re-judges a published fixture row as the answer a journal would hold for it.
const judgedFromFixture = (row, rewrite = (url) => url) => {
  const url = rewrite(row.url);
  const headers = { ...row.headers };
  if (row.headerNames.includes("location")) headers.location = `${url}&upload_id=session-1`;
  return judgeAnswer(
    answer(row.body ?? (row.shape === "media" ? "fire" : ""), {
      case: row.case,
      method: row.method,
      status: row.status,
      url,
      headers,
    }),
  );
};

test("the published fixture compared with itself and with its re-judged answers MATCHes", async () => {
  const rows = await fixtureRows();
  assert.ok(compare(rows, rows).every((row) => row.verdict === "MATCH"));
  // Success bodies are omitted from the fixture, so only bodiless and error rows can be re-judged.
  for (const row of rows.filter((candidate) =>
    ["json-error", "empty", "resumable-start"].includes(candidate.shape),
  ))
    assert.equal(compare([row], [judgedFromFixture(row)])[0].verdict, "MATCH", row.case);
});

test("a production https Location and a local http Location with another bucket MATCH", async () => {
  const start = (await fixtureRows()).find((row) => row.case === "V3-absent-resumable");
  const production = judgedFromFixture(start);
  const local = judgedFromFixture(start, (url) =>
    url
      .replace("https://storage.googleapis.com", "http://127.0.0.1:39199")
      .replace("fireemu-obs-RUN", "fireemu-obs-local-absent"),
  );
  assert.equal(production.shape, "resumable-start");
  assert.equal(local.shape, "resumable-start");
  assert.equal(compare([production], [local])[0].verdict, "MATCH");
  assert.equal(compare([start], [local])[0].verdict, "MATCH");
});

test("a changed ACL message DIFFERS; a wrong Location path or a missing upload_id never MATCHes", async () => {
  const rows = await fixtureRows();
  const acl = rows.find((row) => row.case === "V3-absent-acl");
  const body = JSON.parse(acl.body);
  body.error.message = "changed ACL message";
  const changed = judgedFromFixture({ ...acl, body: JSON.stringify(body, null, 2) + "\n" });
  assert.equal(changed.known, true);
  assert.equal(compare([acl], [changed])[0].verdict, "DIFFERS(json)");
  const start = rows.find((row) => row.case === "V3-absent-resumable");
  for (const location of [
    start.url.replace("/upload/storage/v1/b/fireemu-obs-RUN/o", "/upload/storage/v1/b/other/o") +
      "&upload_id=session-1",
    start.url.replace("/o?", "/o/extra?") + "&upload_id=session-1",
    start.url,
  ]) {
    const row = judgeAnswer(
      answer("", {
        case: start.case,
        method: "POST",
        status: 200,
        url: start.url,
        headers: { ...start.headers, location },
      }),
    );
    // The judge refuses the shape, so the row is unknown and never MATCHes.
    assert.equal(compare([start], [row])[0].verdict, "NEEDS-REVIEW", location);
    assert.equal(row.location, null, location);
  }
});
