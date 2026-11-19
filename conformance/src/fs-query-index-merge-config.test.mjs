// The index-merge send's configuration program (src/fs-query-index-merge/config.mjs) against a
// fake Firestore Admin API. Nothing here reaches the network: every test injects its own `http`,
// and the production request layer refuses without the launch script's flag, which no test sets.

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  API,
  BudgetExceeded,
  ENTRIES,
  POLL_ROUNDS,
  SEND_FLAG,
  SEND_FLAG_VALUE,
  SETS,
  TOKEN_MAX_AGE_MS,
  apply,
  classify,
  createRequest,
  createSession,
  fieldNamePattern,
  fromJournals,
  indexNamePattern,
  main,
  operationNamePattern,
  parseArgs,
  productionHttp,
  projectForms,
  remove,
  requestCap,
  status,
} from "./fs-query-index-merge/config.mjs";

const NUMBER = "123456789012";
const FORMS = [`fireemu-oracle-query`, NUMBER];
const DB = "projects/fireemu-oracle-query/databases/(default)";
const DB_NUMBER = `projects/${NUMBER}/databases/(default)`;
const readJson = (path) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));

/**
 * A fake Firestore Admin API: composites per group, field overrides, operations that finish after
 * `opRounds` reads. `fail(request)` may return an answer to send instead (an injected failure).
 * Names carry the project number, as production may return them.
 */
function fakeFirestore({
  opRounds = 1,
  fail = () => undefined,
  composites = {},
  fields = {},
} = {}) {
  const state = {
    composites: structuredClone(composites),
    fields: structuredClone(fields),
    ops: {},
  };
  const requests = [];
  let next = 0;
  const op = (target) => {
    next += 1;
    const name = `${DB_NUMBER}/operations/op${next}`;
    state.ops[name] = { left: opRounds, target };
    return { name, metadata: { "@type": "type.googleapis.com/x" } };
  };
  const http = async (request) => {
    requests.push(request);
    const injected = fail(request, requests.length);
    if (injected) return typeof injected === "function" ? injected() : injected;
    const path = request.url.slice(API.length + 1);
    const m = path.match(
      /^projects\/(?:fireemu-oracle-query|\d+)\/databases\/\(default\)\/(collectionGroups\/([^/]+)\/(indexes|fields)(?:\/([^/?]+))?)?(operations\/[^/]+)?(\?.*)?$/,
    );
    if (!m) return { status: 404, json: { error: { code: 404 } } };
    const [, , group, kind, id, opPath] = m;
    if (opPath) {
      const o = state.ops[`${DB_NUMBER}/${opPath}`];
      if (!o) return { status: 404, json: { error: { code: 404 } } };
      o.left -= 1;
      return { status: 200, json: { name: `${DB_NUMBER}/${opPath}`, done: o.left <= 0 } };
    }
    if (kind === "indexes" && !id && request.method === "GET")
      return {
        status: 200,
        json: (state.composites[group] ?? []).length ? { indexes: state.composites[group] } : {},
      };
    if (kind === "indexes" && !id && request.method === "POST") {
      const index = {
        name: `${DB_NUMBER}/collectionGroups/${group}/indexes/CICAg${group}`,
        queryScope: request.body.queryScope,
        fields: [...request.body.fields, { fieldPath: "__name__", order: "ASCENDING" }],
        state: "READY",
      };
      state.composites[group] = [...(state.composites[group] ?? []), index];
      return { status: 200, json: op(index.name) };
    }
    if (kind === "indexes" && id && request.method === "DELETE") {
      const before = state.composites[group] ?? [];
      state.composites[group] = before.filter((i) => !i.name.endsWith(`/${id}`));
      return before.length === state.composites[group].length
        ? { status: 404, json: { error: { code: 404 } } }
        : { status: 200, json: {} };
    }
    if (kind === "fields") {
      const key = `${group}/${id}`;
      const name = `${DB_NUMBER}/collectionGroups/${group}/fields/${id}`;
      if (request.method === "GET")
        return {
          status: 200,
          json: state.fields[key] ?? {
            name,
            indexConfig: { usesAncestorConfig: true, indexes: [{ queryScope: "COLLECTION" }] },
          },
        };
      if (request.method === "PATCH") {
        if (request.body.indexConfig === undefined) delete state.fields[key];
        else
          state.fields[key] = {
            name,
            indexConfig: {
              usesAncestorConfig: false,
              indexes: request.body.indexConfig.indexes.map((i) => ({ ...i, state: "READY" })),
            },
          };
        return { status: 200, json: op(name) };
      }
    }
    return { status: 400, json: { error: { code: 400 } } };
  };
  return { http, state, requests };
}

const session = (fake, cap = 1000, extra = {}) =>
  createSession({ http: fake.http, token: async () => "t", cap, wallMs: 3_600_000, ...extra });
const noSleep = async () => {};
const writesOf = (fake) => fake.requests.filter((r) => r.method !== "GET");

/** The fake after a successful apply of every entry. */
async function appliedFake(options = {}) {
  const fake = fakeFirestore(options);
  const result = await apply({ session: session(fake), set: "all", forms: FORMS, sleep: noSleep });
  assert.equal(result.ok, true);
  return { fake, result };
}

test("the entries are exactly what the merge index file adds to the base file", () => {
  const base = readJson("fs-query-index.indexes.json");
  const merge = readJson("fs-query-index-merge.indexes.json");
  const added = merge.indexes.slice(base.indexes.length);
  const overrides = merge.fieldOverrides.slice(base.fieldOverrides.length);
  const composites = Object.values(ENTRIES).filter((e) => e.kind === "composite");
  assert.deepEqual(
    composites.map((e) => ({
      collectionGroup: e.group,
      queryScope: e.queryScope,
      fields: e.fields,
    })),
    added,
  );
  const fields = Object.values(ENTRIES).filter((e) => e.kind === "override");
  assert.deepEqual(
    fields.map((e) => ({ collectionGroup: e.group, fieldPath: e.field, indexes: e.indexes })),
    overrides,
  );
  assert.deepEqual(SETS, {
    f2: ["E3"],
    f1: ["E1", "E2", "E4", "E5"],
    all: ["E3", "E1", "E2", "E4", "E5"],
  });
});

test("the create requests are firebase-tools' createIndex and patchField bodies, on fixed URLs", () => {
  const g = (group) => `${API}/${DB}/collectionGroups/${group}`;
  assert.deepEqual(createRequest(ENTRIES.E1), {
    method: "POST",
    url: `${g("imx")}/indexes`,
    body: {
      fields: [
        { fieldPath: "a", order: "ASCENDING" },
        { fieldPath: "tags", arrayConfig: "CONTAINS" },
      ],
      queryScope: "COLLECTION",
    },
  });
  assert.equal(createRequest(ENTRIES.E2).url, `${g("imc")}/indexes`);
  assert.deepEqual(createRequest(ENTRIES.E3), {
    method: "PATCH",
    url: `${g("ima")}/fields/a?updateMask=indexConfig`,
    body: {
      indexConfig: {
        indexes: [{ queryScope: "COLLECTION", fields: [{ fieldPath: "a", order: "ASCENDING" }] }],
      },
    },
  });
  assert.deepEqual(createRequest(ENTRIES.E4), {
    method: "PATCH",
    url: `${g("imx")}/fields/a?updateMask=indexConfig`,
    body: { indexConfig: { indexes: [] } },
  });
  assert.deepEqual(createRequest(ENTRIES.E5).url, `${g("imx")}/fields/tags?updateMask=indexConfig`);
});

test("answers classify as done, refused or unknown", () => {
  const json = { name: "x" };
  assert.equal(classify({ status: 200, json }), "done");
  assert.equal(classify({ status: 204, json: {} }), "done");
  for (const s of [400, 403, 404, 409]) assert.equal(classify({ status: s, json }), "refused", s);
  for (const s of [408, 429, 499, 301, 302, 500, 503, 199, 100])
    assert.equal(classify({ status: s, json }), "unknown", s);
  assert.equal(classify({ status: 200 }), "unknown", "unreadable body");
  assert.equal(classify({ status: 409 }), "unknown", "unreadable refusal");
  assert.equal(classify({ error: "timeout" }), "unknown");
  assert.equal(classify(undefined), "unknown");
  assert.equal(classify({ status: "200", json }), "unknown");
});

test("names must match their full expected pattern, for their own group", () => {
  const index = indexNamePattern(FORMS, "imx");
  assert.ok(index.test(`${DB}/collectionGroups/imx/indexes/CICAgOjXh4EK`));
  assert.ok(index.test(`${DB_NUMBER}/collectionGroups/imx/indexes/CICAgOjXh4EK`));
  for (const bad of [
    `${DB}/collectionGroups/imc/indexes/CICAg`,
    `${DB}/collectionGroups/qx/indexes/CICAg`,
    `projects/other/databases/(default)/collectionGroups/imx/indexes/CICAg`,
    `projects/999999999999/databases/(default)/collectionGroups/imx/indexes/CICAg`,
    `projects/fireemu-oracle-query/databases/named/collectionGroups/imx/indexes/CICAg`,
    `${DB}/collectionGroups/imx/indexes/CICAg/extra`,
    `${DB}/collectionGroups/imx/indexes/`,
    `${DB}/collectionGroups/imx/indexes/a b`,
    ` ${DB}/collectionGroups/imx/indexes/CICAg`,
    `${DB}/collectionGroups/imx/indexes/CICAg\n${DB}/collectionGroups/qx/indexes/X`,
  ])
    assert.ok(!index.test(bad), bad);
  const field = fieldNamePattern(FORMS, "imx", "a");
  assert.ok(field.test(`${DB_NUMBER}/collectionGroups/imx/fields/a`));
  assert.ok(!field.test(`${DB}/collectionGroups/imx/fields/tags`));
  assert.ok(!field.test(`${DB}/collectionGroups/ima/fields/a`));
  const op = operationNamePattern(FORMS);
  assert.ok(op.test(`${DB}/operations/S1hX_y-2`));
  assert.ok(!op.test(`${DB}/operations/`));
  assert.ok(!op.test(`${DB}/collectionGroups/imx/operations/x`));
  assert.ok(!op.test("null"));
  assert.deepEqual(projectForms({}), ["fireemu-oracle-query"]);
  assert.deepEqual(projectForms({ FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER }), FORMS);
  assert.deepEqual(projectForms({ FIREEMU_SANDBOX_PROJECT_NUMBER: "12a" }), [
    "fireemu-oracle-query",
  ]);
});

test("the request caps of each subcommand and set", () => {
  assert.equal(POLL_ROUNDS, 40);
  assert.deepEqual(
    Object.fromEntries(
      ["status", "apply", "remove"].map((c) => [
        c,
        ["f2", "f1", "all"].map((s) => requestCap(c, s)),
      ]),
    ),
    { status: [6, 9, 10], apply: [43, 172, 215], remove: [43, 92, 135] },
  );
});

test("apply creates the five entries, polls their operations and reads them back", async () => {
  const fake = fakeFirestore({ opRounds: 3 });
  const s = session(fake, requestCap("apply", "all"));
  const result = await apply({ session: s, set: "all", forms: FORMS, sleep: noSleep });
  assert.equal(result.ok, true);
  for (const id of SETS.all) assert.equal(result.entries[id].outcome, "created", id);
  assert.deepEqual(
    writesOf(fake).map((r) => `${r.method} ${r.url.split("/collectionGroups/")[1]}`),
    [
      "PATCH ima/fields/a?updateMask=indexConfig",
      "POST imx/indexes",
      "POST imc/indexes",
      "PATCH imx/fields/a?updateMask=indexConfig",
      "PATCH imx/fields/tags?updateMask=indexConfig",
    ],
  );
  // 5 reads before, 5 writes, 3 polls each, 5 reads after.
  assert.equal(result.sent, 5 + 5 + 15 + 5);
  assert.ok(result.sent <= requestCap("apply", "all"));
});

test("apply sends nothing unless every entry of the set reads absent", async () => {
  for (const [label, options] of [
    [
      "a composite exists",
      {
        composites: {
          imc: [
            { name: `${DB}/collectionGroups/imc/indexes/X`, queryScope: "COLLECTION", fields: [] },
          ],
        },
      },
    ],
    [
      "an override exists",
      {
        fields: {
          "imx/a": { name: `${DB}/collectionGroups/imx/fields/a`, indexConfig: { indexes: [] } },
        },
      },
    ],
    [
      "a read fails",
      { fail: (r) => (r.url.includes("/imc/") ? { status: 503, json: {} } : undefined) },
    ],
    [
      "a read times out",
      { fail: (r) => (r.url.includes("/fields/tags") ? { error: "timeout" } : undefined) },
    ],
  ]) {
    const fake = fakeFirestore(options);
    const result = await apply({
      session: session(fake),
      set: "all",
      forms: FORMS,
      sleep: noSleep,
    });
    assert.equal(result.ok, false, label);
    assert.equal(result.refusedBeforeSending, true, label);
    assert.deepEqual(writesOf(fake), [], label);
  }
});

test("apply never re-sends and stops at the first write that is not done", async () => {
  // The imx POST times out but the server created the index: an own read shows it (created).
  const fake = fakeFirestore({
    fail: (r) =>
      r.method === "POST" && r.url.includes("/imx/")
        ? () => {
            fake.state.composites.imx = [
              {
                name: `${DB_NUMBER}/collectionGroups/imx/indexes/LATE`,
                queryScope: "COLLECTION",
                fields: [...ENTRIES.E1.fields, { fieldPath: "__name__", order: "ASCENDING" }],
                state: "READY",
              },
            ];
            return { error: "timeout" };
          }
        : undefined,
  });
  const result = await apply({ session: session(fake), set: "all", forms: FORMS, sleep: noSleep });
  assert.equal(result.ok, false);
  assert.equal(result.entries.E3.outcome, "created");
  assert.equal(result.entries.E1.write.class, "unknown");
  assert.equal(result.entries.E1.outcome, "created", "an unknown create settles on an own read");
  for (const id of ["E2", "E4", "E5"]) {
    assert.equal(result.entries[id].write.class, "not-sent", id);
    assert.equal(result.entries[id].outcome, "not-sent", id);
  }
  assert.equal(writesOf(fake).filter((r) => r.method === "POST").length, 1, "no re-send");
});

test("an unknown create that reads absent stays open, a refused one is not created", async () => {
  const fake = fakeFirestore({
    fail: (r) =>
      r.method === "POST" && r.url.includes("/imx/") ? { status: 503, json: {} } : undefined,
  });
  const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  assert.equal(result.entries.E1.outcome, "open", "absence never settles an unknown create");
  const refused = fakeFirestore({
    fail: (r) =>
      r.method === "POST" ? { status: 409, json: { error: { code: 409 } } } : undefined,
  });
  const second = await apply({
    session: session(refused),
    set: "f1",
    forms: FORMS,
    sleep: noSleep,
  });
  assert.equal(second.entries.E1.outcome, "not-created");
  assert.equal(second.entries.E2.outcome, "not-sent");
  assert.equal(second.ok, false);
});

test("an operation that never finishes is polled at most POLL_ROUNDS times", async () => {
  const fake = fakeFirestore({ opRounds: Infinity });
  const sleeps = [];
  const result = await apply({
    session: session(fake, requestCap("apply", "f2")),
    set: "f2",
    forms: FORMS,
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal(result.entries.E3.operation, "running");
  assert.equal(fake.requests.filter((r) => r.url.includes("/operations/")).length, POLL_ROUNDS);
  assert.equal(sleeps.length, POLL_ROUNDS - 1);
  assert.ok(result.sent <= requestCap("apply", "f2"));
});

test("a done create with a malformed operation name is not polled", async () => {
  const fake = fakeFirestore({
    fail: (r) => (r.method === "PATCH" ? { status: 200, json: { name: "null" } } : undefined),
  });
  const result = await apply({ session: session(fake), set: "f2", forms: FORMS, sleep: noSleep });
  assert.equal(result.entries.E3.write.operation, undefined);
  assert.equal(fake.requests.filter((r) => r.url.endsWith("/null")).length, 0);
});

test("remove deletes by the names it read and resets with an empty body; all close", async () => {
  const { fake, result: applied } = await appliedFake();
  fake.requests.length = 0;
  const result = await remove({
    session: session(fake, requestCap("remove", "all")),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
    applied: fromJournals([`${JSON.stringify({ result: { command: "apply", ...applied } })}\n`])
      .applied,
  });
  assert.equal(result.ok, true);
  for (const id of SETS.all) assert.equal(result.entries[id].outcome, "closed", id);
  const writes = writesOf(fake);
  assert.deepEqual(
    writes.map((r) => [r.method, r.url.split("/collectionGroups/")[1], r.body]),
    [
      ["PATCH", "ima/fields/a", {}],
      ["DELETE", "imx/indexes/CICAgimx", undefined],
      ["DELETE", "imc/indexes/CICAgimc", undefined],
      ["PATCH", "imx/fields/a", {}],
      ["PATCH", "imx/fields/tags", {}],
    ],
  );
  assert.deepEqual(fake.state.composites, { imx: [], imc: [] });
  assert.deepEqual(fake.state.fields, {});
  assert.ok(result.sent <= requestCap("remove", "all"));
});

test("remove sends nothing unless every read is the expected entry or its absence", async () => {
  const listed = (group, extra) => ({
    name: `${DB}/collectionGroups/${group}/indexes/X`,
    queryScope: "COLLECTION",
    fields: [...ENTRIES.E1.fields, { fieldPath: "__name__", order: "ASCENDING" }],
    state: "READY",
    ...extra,
  });
  const cases = [
    [
      "two indexes in a group",
      {
        composites: {
          imx: [listed("imx"), listed("imx", { name: `${DB}/collectionGroups/imx/indexes/Y` })],
        },
      },
    ],
    [
      "fields in another order",
      {
        composites: {
          imc: [
            listed("imc", {
              fields: [
                ENTRIES.E1.fields[1],
                ENTRIES.E1.fields[0],
                { fieldPath: "__name__", order: "ASCENDING" },
              ],
            }),
          ],
        },
      },
    ],
    ["no __name__ suffix", { composites: { imc: [listed("imc", { fields: ENTRIES.E1.fields })] } }],
    [
      "collection-group scope",
      { composites: { imx: [listed("imx", { queryScope: "COLLECTION_GROUP" })] } },
    ],
    ["a name of another group", { composites: { imx: [listed("qx")] } }],
    [
      "a name of another project",
      {
        composites: {
          imx: [
            listed("imx", {
              name: "projects/other/databases/(default)/collectionGroups/imx/indexes/X",
            }),
          ],
        },
      },
    ],
    [
      "a second page",
      {
        fail: (r) =>
          r.url.includes("/imc/indexes")
            ? { status: 200, json: { indexes: [], nextPageToken: "p" } }
            : undefined,
      },
    ],
    [
      "a 403 read",
      { fail: (r) => (r.url.includes("/imx/indexes") ? { status: 403, json: {} } : undefined) },
    ],
    [
      "a 503 read",
      {
        fail: (r) =>
          r.url.includes("/fields/a") && r.url.includes("/ima/")
            ? { status: 503, json: {} }
            : undefined,
      },
    ],
    [
      "an unreadable read",
      { fail: (r) => (r.url.includes("/fields/tags") ? { status: 200 } : undefined) },
    ],
    [
      "a field with a TTL",
      {
        fields: {
          "imx/tags": {
            name: `${DB}/collectionGroups/imx/fields/tags`,
            ttlConfig: { state: "ACTIVE" },
            indexConfig: { usesAncestorConfig: true },
          },
        },
      },
    ],
    [
      "an override that is not the entry",
      {
        fields: {
          "ima/a": {
            name: `${DB}/collectionGroups/ima/fields/a`,
            indexConfig: {
              usesAncestorConfig: false,
              indexes: [
                { queryScope: "COLLECTION", fields: [{ fieldPath: "a", order: "DESCENDING" }] },
              ],
            },
          },
        },
      },
    ],
    [
      "a field of another name",
      {
        fields: {
          "imx/a": { name: `${DB}/collectionGroups/imx/fields/b`, indexConfig: { indexes: [] } },
        },
      },
    ],
  ];
  for (const [label, options] of cases) {
    const fake = fakeFirestore(options);
    const result = await remove({
      session: session(fake),
      set: "all",
      forms: FORMS,
      sleep: noSleep,
    });
    assert.equal(result.refusedBeforeSending, true, label);
    assert.deepEqual(writesOf(fake), [], label);
  }
});

test("remove closes an absent entry only when its apply never created it", async () => {
  for (const [applied, expected] of [
    [{}, "open"],
    [{ E1: "created" }, "open"],
    [{ E1: "open" }, "open"],
    [{ E1: "created-not-ready" }, "open"],
    [{ E1: "not-created" }, "closed"],
    [{ E1: "not-sent" }, "closed"],
  ]) {
    const fake = fakeFirestore();
    const result = await remove({
      session: session(fake),
      set: "f1",
      forms: FORMS,
      sleep: noSleep,
      applied,
    });
    assert.equal(result.entries.E1.outcome, expected, JSON.stringify(applied));
    assert.deepEqual(writesOf(fake), []);
  }
});

test("a reset answering 503 or a malformed name leaves the entry open and polls nothing", async () => {
  for (const answer of [
    { status: 503, json: {} },
    { status: 200, json: { name: "null" } },
    { error: "reset" },
  ]) {
    const { fake } = await appliedFake({
      fail: (r) => (r.method === "PATCH" && r.body && !r.body.indexConfig ? answer : undefined),
    });
    fake.requests.length = 0;
    const result = await remove({
      session: session(fake),
      set: "f2",
      forms: FORMS,
      sleep: noSleep,
    });
    assert.equal(result.entries.E3.outcome, "open", JSON.stringify(answer));
    assert.equal(fake.requests.filter((r) => r.url.includes("/operations/")).length, 0);
    assert.equal(writesOf(fake).length, 1, "sent once");
  }
});

test("an unknown DELETE is not re-sent and its entry stays open while it reads present", async () => {
  const { fake } = await appliedFake({
    fail: (r) => (r.method === "DELETE" ? { error: "timeout" } : undefined),
  });
  fake.requests.length = 0;
  const result = await remove({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  assert.equal(result.entries.E1.write.class, "unknown");
  assert.equal(result.entries.E1.outcome, "open");
  assert.equal(fake.requests.filter((r) => r.method === "DELETE").length, 2);
  assert.equal(result.entries.E4.outcome, "closed");
});

test("status reads each entry once and each named operation once", async () => {
  const { fake } = await appliedFake();
  fake.requests.length = 0;
  const result = await status({
    session: session(fake, requestCap("status", "all")),
    set: "all",
    forms: FORMS,
    operations: { "apply:E3": `${DB_NUMBER}/operations/op1`, "apply:E1": "null" },
  });
  assert.equal(result.applied, true);
  assert.equal(result.baseline, false);
  assert.equal(result.operations["apply:E3"], "done");
  assert.equal(result.operations["apply:E1"], "unreadable");
  assert.equal(fake.requests.length, 6);
  assert.ok(fake.requests.every((r) => r.method === "GET"));
  const empty = fakeFirestore();
  const baseline = await status({ session: session(empty), set: "all", forms: FORMS });
  assert.equal(baseline.baseline, true);
});

test("the session enforces the request cap, the wall time and a fresh token", async () => {
  const fake = fakeFirestore();
  const capped = session(fake, 2);
  await capped.send("x", { method: "GET", url: `${API}/${DB}/a` });
  await capped.send("x", { method: "GET", url: `${API}/${DB}/b` });
  await assert.rejects(capped.send("x", { method: "GET", url: `${API}/${DB}/c` }), BudgetExceeded);
  assert.equal(fake.requests.length, 2);
  let t = 0;
  const timed = createSession({
    http: fake.http,
    token: async () => "t",
    cap: 10,
    wallMs: 100,
    now: () => t,
  });
  t = 100;
  await assert.rejects(timed.send("x", { method: "GET", url: `${API}/${DB}/d` }), BudgetExceeded);
  let fetched = 0;
  const tokens = [];
  const http = async (r) => (tokens.push(r.token), { status: 200, json: {} });
  const fresh = createSession({
    http,
    token: async () => `t${(fetched += 1)}`,
    cap: 10,
    wallMs: 3_600_000,
    now: () => t,
  });
  t = 0;
  await fresh.send("x", { method: "GET", url: "u" });
  t = TOKEN_MAX_AGE_MS - 1;
  await fresh.send("x", { method: "GET", url: "u" });
  t = TOKEN_MAX_AGE_MS;
  await fresh.send("x", { method: "GET", url: "u" });
  assert.deepEqual(tokens, ["t1", "t1", "t2"]);
  // A thrown request is journaled as an error answer, never retried.
  const rows = [];
  const throwing = createSession({
    http: async () => {
      throw new Error("socket hang up");
    },
    token: async () => "t",
    cap: 5,
    wallMs: 1000,
    journal: (row) => rows.push(row),
  });
  assert.equal(
    classify(await throwing.send("x", { method: "POST", url: "u", body: {} })),
    "unknown",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, "socket hang up");
  assert.ok(!JSON.stringify(rows).includes('"t"'), "the token is not journaled");
});

test("the production request layer refuses without the exact flag and outside the database", async () => {
  assert.equal(process.env[SEND_FLAG], undefined, "no test runs with the flag");
  assert.throws(() => productionHttp({}), /refusing to send/);
  assert.throws(() => productionHttp({ [SEND_FLAG]: "1" }), /refusing to send/);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return { status: 200, text: async () => '{"ok":true}' };
  };
  const http = productionHttp({ [SEND_FLAG]: SEND_FLAG_VALUE }, fetchImpl);
  for (const url of [
    "https://example.com/v1/projects/fireemu-oracle-query/databases/(default)/x",
    `${API}/projects/other/databases/(default)/x`,
    `${API}/projects/fireemu-oracle-query/databases/named/x`,
    `${API}/projects/${NUMBER}/databases/(default)/x`,
  ])
    await assert.rejects(http({ method: "GET", url, token: "t" }), /refusing a request/, url);
  assert.equal(calls.length, 0);
  const answer = await http({
    method: "PATCH",
    url: `${API}/${DB}/collectionGroups/ima/fields/a`,
    body: {},
    token: "tok",
  });
  assert.deepEqual(answer, { status: 200, json: { ok: true }, bytes: 11 });
  const [, init] = calls[0];
  assert.equal(init.headers.authorization, "Bearer tok");
  assert.equal(init.headers["x-goog-user-project"], "fireemu-oracle-query");
  assert.equal(init.body, "{}");
  assert.ok(init.signal instanceof AbortSignal);
  const withNumber = productionHttp(
    { [SEND_FLAG]: SEND_FLAG_VALUE, FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
    fetchImpl,
  );
  await withNumber({ method: "GET", url: `${API}/${DB_NUMBER}/operations/x`, token: "t" });
  const unreadable = productionHttp({ [SEND_FLAG]: SEND_FLAG_VALUE }, async () => ({
    status: 502,
    text: async () => "<html>",
  }));
  assert.equal(
    classify(await unreadable({ method: "GET", url: `${API}/${DB}/x`, token: "t" })),
    "unknown",
  );
});

test("no test source names the flag's value", async () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const file of (await readdir(here)).filter((f) => f.endsWith(".test.mjs"))) {
    const text = await readFile(join(here, file), "utf8");
    assert.ok(!text.includes(SEND_FLAG_VALUE), file);
  }
});

test("arguments: the set is required and closed, --out is required, apply takes no journal", () => {
  assert.deepEqual(parseArgs(["apply", "--set", "f2", "--out", "o"]), {
    command: "apply",
    set: "f2",
    out: "o",
    journals: [],
  });
  for (const argv of [
    [],
    ["deploy", "--set", "all", "--out", "o"],
    ["apply", "--out", "o"],
    ["apply", "--set", "f3", "--out", "o"],
    ["apply", "--set", "all"],
    ["apply", "--set", "all", "--out", "o", "--journal", "j"],
    ["remove", "--set", "all", "--out"],
    ["status", "--set", "all", "--out", "o", "--force", "x"],
  ])
    assert.throws(() => parseArgs(argv), JSON.stringify(argv));
});

test("main writes a fresh journal and result, refuses an existing directory and the missing flag", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-config-"));
  try {
    assert.equal(await main(["status", "--set", "all", "--out", join(root, "x")], { env: {} }), 3);
    const fake = fakeFirestore();
    const out = join(root, "apply");
    const code = await main(["apply", "--set", "all", "--out", out], {
      env: { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
      http: fake.http,
      token: async () => "secret-token",
      sleep: noSleep,
    });
    assert.equal(code, 0);
    const journal = await readFile(join(out, "journal.jsonl"), "utf8");
    assert.ok(!journal.includes("secret-token"));
    const rows = journal
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(rows.at(-1).result.command, "apply");
    assert.equal(rows.at(-1).result.sent, rows.length - 1);
    assert.deepEqual(JSON.parse(await readFile(join(out, "result.json"), "utf8")).ok, true);
    assert.equal(
      await main(["apply", "--set", "all", "--out", out], {
        http: fake.http,
        token: async () => "t",
      }),
      3,
      "an existing directory",
    );
    const removed = join(root, "remove");
    assert.equal(
      await main(
        ["remove", "--set", "all", "--out", removed, "--journal", join(out, "journal.jsonl")],
        {
          env: { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
          http: fake.http,
          token: async () => "t",
          sleep: noSleep,
        },
      ),
      0,
    );
    const again = join(root, "remove-again");
    // Everything is absent now; without the apply journal nothing can close.
    assert.equal(
      await main(["remove", "--set", "all", "--out", again], {
        http: fake.http,
        token: async () => "t",
        sleep: noSleep,
      }),
      2,
    );
    const statusOut = join(root, "status");
    assert.equal(
      await main(
        [
          "status",
          "--set",
          "all",
          "--out",
          statusOut,
          "--journal",
          join(out, "journal.jsonl"),
          "--journal",
          join(removed, "journal.jsonl"),
        ],
        {
          env: { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
          http: fake.http,
          token: async () => "t",
        },
      ),
      0,
    );
    const statusResult = JSON.parse(await readFile(join(statusOut, "result.json"), "utf8"));
    assert.equal(statusResult.baseline, true);
    assert.ok(statusResult.sent <= requestCap("status", "all"));
    // A cap hit ends the run with the error in the result, not a thrown exception.
    const tiny = join(root, "tiny");
    const capped = await main(["apply", "--set", "all", "--out", tiny], {
      http: async () => ({ error: "x" }),
      token: async () => {
        throw new Error("no ADC");
      },
    });
    assert.equal(capped, 2);
    assert.match(JSON.parse(await readFile(join(tiny, "result.json"), "utf8")).error, /no ADC/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "under the mutation sandbox the barrier holds before any mutant runs",
  { skip: process.env.NEGCACHE_SANDBOX !== "1" },
  async () => {
    assert.equal(process.env[SEND_FLAG], undefined);
    for (const key of Object.keys(process.env))
      assert.ok(!/^(GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_TOKEN|CLOUDSDK_)/.test(key), key);
    assert.throws(() =>
      readFileSync(join(process.env.NEGCACHE_REAL_DOCS_LOCAL, "sandbox-oracles.md")),
    );
    await assert.rejects(
      new Promise((resolve, reject) => {
        const socket = net.connect({ host: "142.250.0.1", port: 443, timeout: 3000 });
        socket.once("connect", () => (socket.destroy(), resolve()));
        socket.once("timeout", () => (socket.destroy(), reject(new Error("timeout"))));
        socket.once("error", reject);
      }),
    );
  },
);

test("an entry that reads present but not READY, or whose operation failed, is not created", async () => {
  const creating = fakeFirestore();
  const original = creating.http;
  const notReady = async (request) => {
    const answer = await original(request);
    if (request.method === "GET" && answer.json?.indexes)
      answer.json = { indexes: answer.json.indexes.map((i) => ({ ...i, state: "CREATING" })) };
    if (request.method === "GET" && answer.json?.indexConfig?.usesAncestorConfig === false)
      answer.json = {
        ...answer.json,
        indexConfig: {
          ...answer.json.indexConfig,
          indexes: [
            {
              queryScope: "COLLECTION",
              fields: [{ fieldPath: "a", order: "ASCENDING" }],
              state: "CREATING",
            },
          ],
        },
      };
    return answer;
  };
  for (const set of ["f2", "f1"]) {
    const result = await apply({
      session: createSession({
        http: notReady,
        token: async () => "t",
        cap: 1000,
        wallMs: 3_600_000,
      }),
      set,
      forms: FORMS,
      sleep: noSleep,
    });
    const id = set === "f2" ? "E3" : "E1";
    assert.equal(result.entries[id].outcome, "created-not-ready", set);
    assert.equal(result.ok, false, set);
    creating.state.composites = {};
    creating.state.fields = {};
  }
  const failed = fakeFirestore({
    fail: (r) =>
      r.url.includes("/operations/")
        ? {
            status: 200,
            json: { name: r.url.slice(API.length + 1), done: true, error: { code: 9 } },
          }
        : undefined,
  });
  const result = await apply({ session: session(failed), set: "f2", forms: FORMS, sleep: noSleep });
  assert.equal(result.entries.E3.operation, "failed");
  assert.equal(result.entries.E3.outcome, "created-not-ready");
});

test("a reset closes only when its own operation reads done under its own name", async () => {
  for (const [label, answer] of [
    [
      "never done",
      (r) => ({ status: 200, json: { name: r.url.slice(API.length + 1), done: false } }),
    ],
    ["another name", () => ({ status: 200, json: { name: `${DB}/operations/other`, done: true } })],
    [
      "done with an error",
      (r) => ({
        status: 200,
        json: { name: r.url.slice(API.length + 1), done: true, error: { code: 13 } },
      }),
    ],
  ]) {
    const { fake } = await appliedFake();
    const original = fake.http;
    const http = async (r) => (r.url.includes("/operations/") ? answer(r) : original(r));
    const result = await remove({
      session: createSession({ http, token: async () => "t", cap: 1000, wallMs: 3_600_000 }),
      set: "f2",
      forms: FORMS,
      sleep: noSleep,
    });
    assert.equal(result.entries.E3.after.state, "absent", label);
    assert.equal(result.entries.E3.outcome, "open", label);
  }
});

test("only apply results give apply outcomes, and status baseline needs every entry absent", async () => {
  const journal = [
    { result: { command: "apply", entries: { E1: { outcome: "not-created" } } } },
    { result: { command: "remove", entries: { E1: { outcome: "open" } } } },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");
  assert.deepEqual(fromJournals([journal]).applied, { E1: "not-created" });
  const fake = fakeFirestore();
  await apply({ session: session(fake), set: "f2", forms: FORMS, sleep: noSleep });
  const partial = await status({ session: session(fake), set: "all", forms: FORMS });
  assert.equal(partial.ok, true);
  assert.equal(partial.baseline, false);
  assert.equal(partial.applied, false);
});

test("a second remove closes what the first removed and removes what it left", async () => {
  // The first remove's imc DELETE timed out; the index stayed. A later remove deletes it, and the
  // entries the first remove closed stay closed by its journal.
  const { fake, result: applied } = await appliedFake();
  const applyJournal = `${JSON.stringify({ result: { command: "apply", ...applied } })}\n`;
  const first = await remove({
    session: createSession({
      http: async (r) =>
        r.method === "DELETE" && r.url.includes("/imc/") ? { error: "timeout" } : fake.http(r),
      token: async () => "t",
      cap: 1000,
      wallMs: 3_600_000,
    }),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
    ...fromJournals([applyJournal]),
  });
  assert.equal(first.entries.E2.outcome, "open");
  assert.equal(first.entries.E1.outcome, "closed");
  const firstJournal = `${JSON.stringify({ result: { command: "remove", ...first } })}\n`;
  const earlier = fromJournals([applyJournal, firstJournal]);
  assert.deepEqual(earlier.removed.toSorted(), ["E1", "E3", "E4", "E5"]);
  assert.deepEqual(earlier.applied.E1, "created", "remove results do not change apply outcomes");
  fake.requests.length = 0;
  const second = await remove({
    session: session(fake),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
    ...earlier,
  });
  assert.equal(second.ok, true);
  assert.deepEqual(
    writesOf(fake).map((r) => r.method),
    ["DELETE"],
  );
  // Without the first remove's journal the entries it removed cannot close.
  const blind = await remove({
    session: session(fake),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
    ...fromJournals([applyJournal]),
  });
  assert.equal(blind.ok, false);
});

test("main passes earlier remove journals on, so a second remove can close the send", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-config-second-"));
  try {
    const fake = fakeFirestore();
    const run = (argv, http = fake.http) =>
      main(argv, {
        env: { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
        http,
        token: async () => "t",
        sleep: noSleep,
      });
    const j = (name) => join(root, name, "journal.jsonl");
    assert.equal(await run(["apply", "--set", "all", "--out", join(root, "apply")]), 0);
    const timeoutImc = (r) =>
      r.method === "DELETE" && r.url.includes("/imc/") ? { error: "timeout" } : fake.http(r);
    assert.equal(
      await run(
        ["remove", "--set", "all", "--out", join(root, "r1"), "--journal", j("apply")],
        timeoutImc,
      ),
      2,
    );
    assert.equal(
      await run([
        "remove",
        "--set",
        "all",
        "--out",
        join(root, "r2"),
        "--journal",
        j("apply"),
        "--journal",
        j("r1"),
      ]),
      0,
    );
    assert.deepEqual(fake.state.composites, { imx: [], imc: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
