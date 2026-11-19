// The index-merge send's configuration program (src/fs-query-index-merge/config.mjs) against a
// fake Firestore Admin API. Nothing here reaches the network: every test injects its own `http`,
// and the production request layer refuses without the launch script's flag, which no test sets.

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  API,
  BudgetExceeded,
  adcToken,
  attempt2Allowed,
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
  entryState,
  fieldNamePattern,
  fromJournals,
  indexNamePattern,
  main,
  operationNamePattern,
  operationState,
  parseArgs,
  productionHttp,
  projectForms,
  readStates,
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
 * A fake Firestore Admin API that answers in the shapes production was recorded answering
 * (conformance/fs-config-lifecycle-production.json, program fs-config/field/index-config/exemption:
 * an inherited field carries usesAncestorConfig true, an override omits it, an exemption omits
 * `indexes`, operations are database-level with Index/FieldOperationMetadata; composites as the
 * FS-CONFIG lists show them, with density SPARSE_ALL). Composites per group, field overrides,
 * operations that finish after `opRounds` reads. `fail(request)` may return an answer to send
 * instead (an injected failure). Names carry the project number, as production may return them.
 */
const ANCESTOR = `${DB_NUMBER}/collectionGroups/__default__/fields/*`;
const INDEX_META = "type.googleapis.com/google.firestore.admin.v1.IndexOperationMetadata";
const FIELD_META = "type.googleapis.com/google.firestore.admin.v1.FieldOperationMetadata";
const modeJson = (fieldPath, mode) => ({
  fields: [
    mode.arrayConfig
      ? { arrayConfig: mode.arrayConfig, fieldPath }
      : { fieldPath, order: mode.order },
  ],
  queryScope: mode.queryScope,
  state: "READY",
});
const inherited = (name, fieldPath) => ({
  indexConfig: {
    ancestorField: ANCESTOR,
    indexes: [
      modeJson(fieldPath, { queryScope: "COLLECTION", order: "ASCENDING" }),
      modeJson(fieldPath, { queryScope: "COLLECTION", order: "DESCENDING" }),
      modeJson(fieldPath, { queryScope: "COLLECTION", arrayConfig: "CONTAINS" }),
    ],
    usesAncestorConfig: true,
  },
  name,
});
const overrideJson = (name, fieldPath, modes) => ({
  indexConfig: {
    ancestorField: ANCESTOR,
    ...(modes.length ? { indexes: modes.map((m) => modeJson(fieldPath, m)) } : {}),
  },
  name,
});
const listedIndex = (group, extra = {}) => ({
  name: `${DB_NUMBER}/collectionGroups/${group}/indexes/CICAg${group}`,
  queryScope: "COLLECTION",
  fields: [
    { fieldPath: "a", order: "ASCENDING" },
    { arrayConfig: "CONTAINS", fieldPath: "tags" },
    { fieldPath: "__name__", order: "ASCENDING" },
  ],
  state: "READY",
  density: "SPARSE_ALL",
  ...extra,
});

/**
 * The 24 composites of the sandbox `(default)` today, in the shape the send of packet v5.1 recorded
 * (send-v5/status-begin, 2026-11-19: keys name, queryScope, fields, state, density) with the ids
 * replaced: the lane superset fs-query-index.indexes.json, every one on a group the merge corpus
 * does not use.
 */
const BASE_INDEXES = readJson("fs-query-index.indexes.json").indexes.map((index, n) => {
  const vector = index.fields.at(-1)?.vectorConfig ? index.fields.slice(-1) : [];
  const ordered = vector.length ? index.fields.slice(0, -1) : index.fields;
  const hasName = ordered.at(-1)?.fieldPath === "__name__";
  const last = ordered.at(-1)?.order ?? "ASCENDING";
  return {
    name: `${DB_NUMBER}/collectionGroups/${index.collectionGroup}/indexes/BASE${n}`,
    queryScope: index.queryScope,
    fields: [...ordered, ...(hasName ? [] : [{ fieldPath: "__name__", order: last }]), ...vector],
    state: "READY",
    density: "SPARSE_ALL",
  };
});

/**
 * Production's index list ignores the group of its path (send of packet v5.1: `.../collectionGroups/imx/indexes`
 * answered every composite of the database), so the fake answers every list with all of them.
 */
function fakeFirestore({
  opRounds = 1,
  fail = () => undefined,
  composites = {},
  fields = {},
  others = BASE_INDEXES,
  pageSize = Infinity,
} = {}) {
  const state = {
    composites: structuredClone(composites),
    fields: structuredClone(fields),
    others: structuredClone(others),
    ops: {},
  };
  const requests = [];
  let next = 0;
  const op = (metadata, response) => {
    next += 1;
    const name = `${DB_NUMBER}/operations/op${next}`;
    state.ops[name] = { left: opRounds, metadata, response };
    return { metadata: { ...metadata, state: "INITIALIZING" }, name };
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
    const [, , group, kind, id, opPath, query] = m;
    if (opPath) {
      const name = `${DB_NUMBER}/${opPath}`;
      const o = state.ops[name];
      if (!o) return { status: 404, json: { error: { code: 404 } } };
      o.left -= 1;
      return o.left > 0
        ? { status: 200, json: { metadata: { ...o.metadata, state: "PROCESSING" }, name } }
        : {
            status: 200,
            json: {
              done: true,
              metadata: { ...o.metadata, state: "SUCCESSFUL" },
              name,
              response: o.response,
            },
          };
    }
    if (kind === "indexes" && !id && request.method === "GET") {
      // Pages of `pageSize`; a page's token is `t<next offset>`, passed back as ?pageToken=.
      const all = [...state.others, ...Object.values(state.composites).flat()];
      const token = new URL(request.url).searchParams.get("pageToken");
      const start = token === null ? 0 : Number(token.slice(1));
      const page = all.slice(start, start + pageSize);
      const more = start + pageSize < all.length ? { nextPageToken: `t${start + pageSize}` } : {};
      return { status: 200, json: { ...(page.length ? { indexes: page } : {}), ...more } };
    }
    if (kind === "indexes" && !id && request.method === "POST") {
      const index = listedIndex(group, { state: "READY" });
      state.composites[group] = [...(state.composites[group] ?? []), index];
      return {
        status: 200,
        json: op({ "@type": INDEX_META, index: index.name }, { ...index }),
      };
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
        return { status: 200, json: state.fields[key] ?? inherited(name, id) };
      if (request.method === "PATCH" && query === "?updateMask=indexConfig") {
        if (request.body.indexConfig === undefined) delete state.fields[key];
        else
          state.fields[key] = overrideJson(
            name,
            id,
            request.body.indexConfig.indexes.map((i) => ({
              queryScope: i.queryScope,
              ...(i.fields[0].order ? { order: i.fields[0].order } : {}),
              ...(i.fields[0].arrayConfig ? { arrayConfig: i.fields[0].arrayConfig } : {}),
            })),
          );
        return {
          status: 200,
          json: op({ "@type": FIELD_META, field: name }, state.fields[key] ?? inherited(name, id)),
        };
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
    { status: [6, 17, 18], apply: [43, 188, 231], remove: [43, 108, 151] },
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
      { fail: (r) => (r.url.includes("/-/indexes") ? { status: 503, json: {} } : undefined) },
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
  assert.equal(result.entries.E3.outcome, "open", "the override was never made");
  // The server made the override but answered without a readable operation: pending, not created.
  let patched = false;
  const made = fakeFirestore({
    fail: (r) =>
      r.method === "PATCH" && !patched
        ? async () => {
            patched = true;
            await made.http(r);
            return { status: 200, json: { name: "null" } };
          }
        : undefined,
  });
  const second = await apply({ session: session(made), set: "f2", forms: FORMS, sleep: noSleep });
  assert.equal(second.entries.E3.read.state, "present");
  assert.equal(second.entries.E3.outcome, "created-pending");
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
      // The reset is the request the FS-CONFIG-LIFECYCLE recording sent (step "revert").
      ["PATCH", "ima/fields/a?updateMask=indexConfig", {}],
      ["DELETE", "imx/indexes/CICAgimx", undefined],
      ["DELETE", "imc/indexes/CICAgimc", undefined],
      ["PATCH", "imx/fields/a?updateMask=indexConfig", {}],
      ["PATCH", "imx/fields/tags?updateMask=indexConfig", {}],
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
          r.url.includes("/-/indexes")
            ? { status: 200, json: { indexes: [], nextPageToken: "p" } }
            : undefined,
      },
    ],
    [
      "a 403 read",
      { fail: (r) => (r.url.includes("/-/indexes") ? { status: 403, json: {} } : undefined) },
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
    operations: {
      "apply:E3": {
        name: `${DB_NUMBER}/operations/op1`,
        target: `${DB_NUMBER}/collectionGroups/ima/fields/a`,
      },
      "apply:E1": { name: "null", target: `${DB_NUMBER}/collectionGroups/imx/indexes/CICAgimx` },
    },
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
    a2: [],
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
    // The operations the journals name are read back under their own targets.
    assert.ok(Object.keys(statusResult.operations).length > 0);
    for (const [key, state] of Object.entries(statusResult.operations))
      assert.equal(state, "done", key);
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
    if (
      request.method === "GET" &&
      answer.json?.indexConfig &&
      answer.json.indexConfig.usesAncestorConfig !== true &&
      answer.json.indexConfig.indexes
    )
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
            json: {
              done: true,
              error: { code: 9 },
              metadata: {
                "@type": FIELD_META,
                field: `${DB_NUMBER}/collectionGroups/ima/fields/a`,
              },
              name: r.url.slice(API.length + 1),
            },
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

// ---- packet v4 (coordinator ruling 4) ------------------------------------------------------

test("the production layer never follows a redirect, and a 3xx is unknown or unreadable", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return { status: 307, text: async () => "" };
  };
  const http = productionHttp({ [SEND_FLAG]: SEND_FLAG_VALUE }, fetchImpl);
  const answer = await http({
    method: "PATCH",
    url: `${API}/${DB}/collectionGroups/imx/fields/a?updateMask=indexConfig`,
    body: { indexConfig: { indexes: [] } },
    token: "t",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].redirect, "manual");
  assert.equal(classify(answer), "unknown");
  const json307 = { status: 307, json: { name: "x" } };
  assert.equal(classify(json307), "unknown");
  const read = entryState(ENTRIES.E4, json307, FORMS);
  assert.equal(read.state, "unreadable");
  // A URL that a fetch would normalize to another resource is refused before sending.
  for (const url of [
    `${API}/${DB}/collectionGroups/imx/fields/a/../../../../../../other/x`,
    `${API}/${DB}/collectionGroups/imx/fields/%2e%2e/x`,
    `https://firestore.googleapis.com:443/v1/${DB}/collectionGroups/imx/fields/a`,
    `https://user@firestore.googleapis.com/v1/${DB}/collectionGroups/imx/fields/a`,
    `${API}/${DB}/collectionGroups/imx/fields/a#x`,
  ])
    await assert.rejects(http({ method: "GET", url, token: "t" }), /refusing a request/, url);
  assert.equal(calls.length, 1);
});

test("the wall time is checked after the token, and a request gets only the time left", async () => {
  let t = 0;
  const seen = [];
  const http = async (r) => (seen.push(r.timeoutMs), { status: 200, json: {} });
  const late = createSession({
    http,
    token: async () => ((t = 1_000), "t"),
    cap: 10,
    wallMs: 1_000,
    now: () => t,
  });
  await assert.rejects(late.send("x", { method: "PATCH", url: "u", body: {} }), BudgetExceeded);
  assert.equal(late.sent, 0);
  assert.deepEqual(seen, []);
  t = 0;
  const near = createSession({
    http,
    token: async () => "t",
    cap: 10,
    wallMs: 100_000,
    now: () => t,
  });
  t = 95_000;
  await near.send("x", { method: "GET", url: "u" });
  t = 10_000;
  const far = createSession({
    http,
    token: async () => "t",
    cap: 10,
    wallMs: 100_000,
    now: () => t,
  });
  await far.send("x", { method: "GET", url: "u" });
  assert.deepEqual(seen, [5_000, 30_000]);
  // The production layer uses that timeout.
  const signals = [];
  const prod = productionHttp({ [SEND_FLAG]: SEND_FLAG_VALUE }, async (url, init) => {
    signals.push(init.signal);
    return { status: 200, text: async () => "{}" };
  });
  await prod({
    method: "GET",
    url: `${API}/${DB}/collectionGroups/imx/indexes`,
    token: "t",
    timeoutMs: 7,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(signals[0].aborted, true, "a 7 ms budget aborts");
});

test("the ADC token comes from gcloud with a timeout", async () => {
  const calls = [];
  const token = await adcToken(async (file, args, options) => {
    calls.push([file, args, options]);
    return { stdout: "ya29.token\n" };
  });
  assert.equal(token, "ya29.token");
  assert.deepEqual(calls[0][0], "gcloud");
  assert.deepEqual(calls[0][1], ["auth", "application-default", "print-access-token"]);
  assert.equal(calls[0][2].timeout, 30_000);
  await assert.rejects(
    adcToken(async () => ({ stdout: "\n" })),
    /empty/,
  );
});

const fieldAnswer = (json) => ({ status: 200, json });
const E3_NAME = `${DB}/collectionGroups/ima/fields/a`;
const E4_NAME = `${DB}/collectionGroups/imx/fields/a`;
const ANCESTOR_ID = `${DB}/collectionGroups/__default__/fields/*`;

test("a field read is present or absent only in a recorded shape, field by field", () => {
  const e3Index = (extra = {}, field = { fieldPath: "a", order: "ASCENDING" }) => ({
    fields: [field],
    queryScope: "COLLECTION",
    state: "READY",
    ...extra,
  });
  const state = (entry, json) => entryState(entry, fieldAnswer(json), FORMS).state;
  // Recorded shapes: an exemption, an override with indexes, an inherited field.
  assert.equal(
    state(ENTRIES.E4, { indexConfig: { ancestorField: ANCESTOR_ID }, name: E4_NAME }),
    "present",
  );
  assert.equal(
    state(ENTRIES.E3, {
      indexConfig: { ancestorField: ANCESTOR_ID, indexes: [e3Index()] },
      name: E3_NAME,
    }),
    "present",
  );
  assert.equal(
    state(ENTRIES.E4, {
      indexConfig: {
        ancestorField: ANCESTOR_ID,
        indexes: [e3Index({}, { fieldPath: "a", order: "DESCENDING" })],
        usesAncestorConfig: true,
      },
      name: E4_NAME,
    }),
    "absent",
  );
  for (const [label, entry, json] of [
    ["only a name", ENTRIES.E4, { name: E4_NAME }],
    ["no ancestor", ENTRIES.E4, { indexConfig: {}, name: E4_NAME }],
    [
      "another ancestor",
      ENTRIES.E4,
      { indexConfig: { ancestorField: `${DB}/collectionGroups/imx/fields/*` }, name: E4_NAME },
    ],
    [
      "reverting",
      ENTRIES.E4,
      { indexConfig: { ancestorField: ANCESTOR_ID, reverting: true }, name: E4_NAME },
    ],
    [
      "usesAncestorConfig a string",
      ENTRIES.E4,
      { indexConfig: { ancestorField: ANCESTOR_ID, usesAncestorConfig: "false" }, name: E4_NAME },
    ],
    [
      "indexes not an array",
      ENTRIES.E4,
      { indexConfig: { ancestorField: ANCESTOR_ID, indexes: {} }, name: E4_NAME },
    ],
    [
      "an extra top-level key",
      ENTRIES.E4,
      { indexConfig: { ancestorField: ANCESTOR_ID }, name: E4_NAME, extra: 1 },
    ],
    [
      "an extra indexConfig key",
      ENTRIES.E4,
      { indexConfig: { ancestorField: ANCESTOR_ID, other: 1 }, name: E4_NAME },
    ],
    [
      "a TTL",
      ENTRIES.E4,
      {
        indexConfig: { ancestorField: ANCESTOR_ID },
        name: E4_NAME,
        ttlConfig: { state: "ACTIVE" },
      },
    ],
    [
      "a mode field of another path",
      ENTRIES.E3,
      {
        indexConfig: {
          ancestorField: ANCESTOR_ID,
          indexes: [e3Index({}, { fieldPath: "wrong", order: "ASCENDING" })],
        },
        name: E3_NAME,
      },
    ],
    [
      "two fields in a mode",
      ENTRIES.E3,
      {
        indexConfig: {
          ancestorField: ANCESTOR_ID,
          indexes: [
            {
              ...e3Index(),
              fields: [
                { fieldPath: "a", order: "ASCENDING" },
                { fieldPath: "b", order: "ASCENDING" },
              ],
            },
          ],
        },
        name: E3_NAME,
      },
    ],
    [
      "an extra key in a mode field",
      ENTRIES.E3,
      {
        indexConfig: {
          ancestorField: ANCESTOR_ID,
          indexes: [e3Index({}, { fieldPath: "a", order: "ASCENDING", vectorConfig: {} })],
        },
        name: E3_NAME,
      },
    ],
    [
      "order and arrayConfig",
      ENTRIES.E3,
      {
        indexConfig: {
          ancestorField: ANCESTOR_ID,
          indexes: [e3Index({}, { fieldPath: "a", order: "ASCENDING", arrayConfig: "CONTAINS" })],
        },
        name: E3_NAME,
      },
    ],
    [
      "an extra key in a mode",
      ENTRIES.E3,
      {
        indexConfig: { ancestorField: ANCESTOR_ID, indexes: [e3Index({ density: "DENSE" })] },
        name: E3_NAME,
      },
    ],
    [
      "a second mode",
      ENTRIES.E3,
      {
        indexConfig: {
          ancestorField: ANCESTOR_ID,
          indexes: [e3Index(), e3Index({}, { fieldPath: "a", order: "DESCENDING" })],
        },
        name: E3_NAME,
      },
    ],
    [
      "an inherited field with a malformed mode",
      ENTRIES.E4,
      {
        indexConfig: {
          ancestorField: ANCESTOR_ID,
          indexes: [{ fields: [], queryScope: "COLLECTION" }],
          usesAncestorConfig: true,
        },
        name: E4_NAME,
      },
    ],
    ["a body that is an array", ENTRIES.E4, [{ name: E4_NAME }]],
  ])
    assert.equal(state(entry, json), "unexpected", label);
});

test("a composite read is present only in the recorded shape", () => {
  const listed = (extra = {}) => ({ indexes: [listedIndex("imx", extra)] });
  const state = (json) => entryState(ENTRIES.E1, fieldAnswer(json), FORMS).state;
  assert.equal(state(listed()), "present");
  assert.equal(state(listed({ density: undefined })), "present", "density omitted");
  assert.equal(state({}), "absent");
  for (const [label, json] of [
    ["multikey", listed({ multikey: true })],
    ["another density", listed({ density: "SPARSE_ANY" })],
    ["an API scope", listed({ apiScope: "MONGODB_COMPATIBLE_API" })],
    [
      "an extra key in a field",
      listed({
        fields: [
          { fieldPath: "a", order: "ASCENDING", x: 1 },
          { arrayConfig: "CONTAINS", fieldPath: "tags" },
          { fieldPath: "__name__", order: "ASCENDING" },
        ],
      }),
    ],
    ["an extra list key", { indexes: [listedIndex("imx")], unreachable: ["x"] }],
    ["indexes not an array", { indexes: {} }],
    ["no state", listed({ state: undefined })],
    ["a body that is an array", [listedIndex("imx")]],
  ])
    assert.equal(state(JSON.parse(JSON.stringify(json))), "unexpected", label);
});

test("an operation counts only in the recorded shape, for its own entry", () => {
  const name = `${DB}/operations/op9`;
  const field = (extra = {}) => ({
    status: 200,
    json: {
      done: true,
      metadata: { "@type": FIELD_META, field: E4_NAME, state: "SUCCESSFUL" },
      name,
      response: {},
      ...extra,
    },
  });
  assert.equal(operationState(field(), name, FORMS, ENTRIES.E4, E4_NAME), "done");
  assert.equal(
    operationState(
      { status: 200, json: { metadata: { "@type": FIELD_META, field: E4_NAME }, name } },
      name,
      FORMS,
      ENTRIES.E4,
      E4_NAME,
    ),
    "running",
  );
  assert.equal(
    operationState(
      field({ response: undefined, error: { code: 13 } }),
      name,
      FORMS,
      ENTRIES.E4,
      E4_NAME,
    ),
    "failed",
  );
  for (const [label, answer, entry] of [
    ["done without a response", field({ response: undefined }), ENTRIES.E4],
    ["another field's entry", field(), ENTRIES.E5],
    [
      "an index operation for a field",
      {
        status: 200,
        json: {
          ...field().json,
          metadata: { "@type": INDEX_META, index: `${DB}/collectionGroups/imx/indexes/X` },
        },
      },
      ENTRIES.E4,
    ],
    ["no metadata", { status: 200, json: { done: true, name, response: {} } }, ENTRIES.E4],
    ["an extra key", field({ other: 1 }), ENTRIES.E4],
    ["done not a boolean", field({ done: "true" }), ENTRIES.E4],
    ["another name", field({ name: `${DB}/operations/op8` }), ENTRIES.E4],
  ])
    assert.equal(
      operationState(JSON.parse(JSON.stringify(answer)), name, FORMS, entry, E4_NAME),
      "unreadable",
      label,
    );
  const index = {
    status: 200,
    json: {
      done: true,
      metadata: {
        "@type": INDEX_META,
        index: `${DB_NUMBER}/collectionGroups/imc/indexes/CICAgimc`,
      },
      name,
      response: {},
    },
  };
  const imc = `${DB_NUMBER}/collectionGroups/imc/indexes/CICAgimc`;
  assert.equal(operationState(index, name, FORMS, ENTRIES.E2, imc), "done");
  assert.equal(operationState(index, name, FORMS, ENTRIES.E2), "unreadable", "no target");
  assert.equal(
    operationState(index, name, FORMS, ENTRIES.E1, imc),
    "unreadable",
    "another group's index",
  );
});

test("an exemption whose operation never finishes is pending, not created", async () => {
  const fake = fakeFirestore({ opRounds: Infinity });
  const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  for (const id of ["E4", "E5"]) {
    assert.equal(result.entries[id].read.state, "present", id);
    assert.equal(result.entries[id].operation, "running", id);
    assert.equal(result.entries[id].outcome, "created-pending", id);
  }
  assert.equal(result.ok, false);
});

test("attempt 2 of remove needs an a2 read after attempt 1, 10 minutes later, showing an entry present", () => {
  const t = (minutes) => new Date(Date.UTC(2026, 10, 19, 12, minutes)).toISOString();
  const first = { command: "remove", set: "all", finishedAt: t(0), ok: false };
  const a2 = (minutes, states, extra = {}) => ({
    command: "status",
    set: "all",
    ok: true,
    startedAt: t(minutes),
    states,
    ...extra,
  });
  const present = {
    E1: { state: "present" },
    E2: { state: "absent" },
    E3: { state: "absent" },
    E4: { state: "absent" },
    E5: { state: "absent" },
  };
  const none = { ...present, E1: { state: "absent" } };
  assert.equal(attempt2Allowed({ set: "all", first, a2: [a2(10, present)] }).allowed, true);
  for (const [label, args] of [
    ["no a2", { set: "all", first, a2: [] }],
    ["a2 too early", { set: "all", first, a2: [a2(9, present)] }],
    ["a2 before attempt 1", { set: "all", first, a2: [a2(-5, present)] }],
    ["nothing present", { set: "all", first, a2: [a2(12, none)] }],
    ["a2 not readable", { set: "all", first, a2: [a2(12, present, { ok: false })] }],
    ["a2 of another set", { set: "all", first, a2: [a2(12, present, { set: "f2" })] }],
    ["no attempt 1", { set: "all", first: undefined, a2: [a2(12, present)] }],
    [
      "attempt 1 of another set",
      { set: "all", first: { ...first, set: "f1" }, a2: [a2(12, present)] },
    ],
    [
      "attempt 1 closed everything",
      { set: "all", first: { ...first, ok: true }, a2: [a2(12, present)] },
    ],
  ])
    assert.equal(attempt2Allowed(args).allowed, false, label);
});

test("result files carry their start and finish times", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-config-times-"));
  try {
    let t = Date.UTC(2026, 10, 19, 12, 0);
    const fake = fakeFirestore();
    const out = join(root, "status");
    await main(["status", "--set", "all", "--out", out], {
      http: fake.http,
      token: async () => "t",
      now: () => (t += 1000),
    });
    const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
    assert.match(result.startedAt, /^2026-11-19T12:00:0\d\.000Z$/);
    assert.ok(result.finishedAt > result.startedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("may-retry reads result files only and answers by attempt2Allowed", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-config-retry-"));
  try {
    const write = async (name, json) => {
      const path = join(root, name);
      await writeFile(path, JSON.stringify(json));
      return path;
    };
    const first = await write("first.json", {
      command: "remove",
      set: "all",
      ok: false,
      finishedAt: "2026-11-19T12:00:00.000Z",
    });
    const states = { E1: { state: "present" } };
    const early = await write("early.json", {
      command: "status",
      set: "all",
      ok: true,
      startedAt: "2026-11-19T12:05:00.000Z",
      states,
    });
    const late = await write("late.json", {
      command: "status",
      set: "all",
      ok: true,
      startedAt: "2026-11-19T12:11:00.000Z",
      states,
    });
    const noHttp = async () => assert.fail("may-retry sends nothing");
    assert.equal(
      await main(["may-retry", "--set", "all", "--first", first, "--a2", early], {
        http: noHttp,
        env: {},
      }),
      2,
    );
    assert.equal(
      await main(["may-retry", "--set", "all", "--first", first, "--a2", early, "--a2", late], {
        http: noHttp,
        env: {},
      }),
      0,
    );
    assert.equal(await main(["may-retry", "--set", "all", "--a2", late], { env: {} }), 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unreadable bodies and the reasons a reviewer reads", () => {
  for (const entry of [ENTRIES.E1, ENTRIES.E4])
    for (const json of [null, 7, "x", [{}]])
      assert.equal(
        entryState(entry, { status: 200, json }, FORMS).state,
        "unexpected",
        JSON.stringify(json),
      );
  assert.equal(
    entryState(ENTRIES.E1, { status: 200, json: { indexes: [], nextPageToken: "p" } }, FORMS)
      .reason,
    "more than one page",
  );
  assert.equal(
    entryState(
      ENTRIES.E4,
      {
        status: 200,
        json: { indexConfig: { ancestorField: ANCESTOR_ID }, name: E4_NAME, ttlConfig: {} },
      },
      FORMS,
    ).reason,
    "the field has a TTL",
  );
});

// ---- packet v5 (coordinator ruling 5) ------------------------------------------------------

test("a composite list with a null, scalar or object `indexes` is unexpected and apply sends nothing", async () => {
  for (const indexes of [null, "x", 0, false, {}]) {
    const state = entryState(ENTRIES.E1, { status: 200, json: { indexes } }, FORMS).state;
    assert.equal(state, "unexpected", JSON.stringify(indexes));
    const fake = fakeFirestore({
      fail: (r) =>
        r.method === "GET" && r.url.includes("/-/indexes")
          ? { status: 200, json: { indexes } }
          : undefined,
    });
    const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
    assert.equal(result.refusedBeforeSending, true, JSON.stringify(indexes));
    assert.deepEqual(writesOf(fake), []);
  }
  // Absent `indexes` (proto3 omits an empty list) and an empty list both mean none.
  assert.equal(entryState(ENTRIES.E1, { status: 200, json: {} }, FORMS).state, "absent");
  assert.equal(
    entryState(ENTRIES.E1, { status: 200, json: { indexes: [] } }, FORMS).state,
    "absent",
  );
});

test("null in a field read is unexpected wherever a key may be absent", () => {
  const base = { indexConfig: { ancestorField: ANCESTOR_ID }, name: E4_NAME };
  for (const [label, json] of [
    ["indexes null", { ...base, indexConfig: { ...base.indexConfig, indexes: null } }],
    [
      "usesAncestorConfig null",
      { ...base, indexConfig: { ...base.indexConfig, usesAncestorConfig: null } },
    ],
    ["ancestorField null", { ...base, indexConfig: { ancestorField: null } }],
    ["indexConfig null", { ...base, indexConfig: null }],
    ["ttlConfig null", { ...base, ttlConfig: null }],
    [
      "a mode state null",
      {
        ...base,
        indexConfig: {
          ...base.indexConfig,
          indexes: [
            {
              fields: [{ fieldPath: "a", order: "ASCENDING" }],
              queryScope: "COLLECTION",
              state: null,
            },
          ],
        },
      },
    ],
  ])
    assert.equal(entryState(ENTRIES.E4, { status: 200, json }, FORMS).state, "unexpected", label);
});

test("an operation settles a create only when it names the exact index or field the create gave", async () => {
  const created = `${DB_NUMBER}/collectionGroups/imx/indexes/created`;
  const different = `${DB_NUMBER}/collectionGroups/imx/indexes/different`;
  const opName = `${DB_NUMBER}/operations/opX`;
  const fake = fakeFirestore({
    fail: (r) => {
      if (r.method === "POST" && r.url.includes("/imx/indexes")) {
        fake.state.composites.imx = [listedIndex("imx", { name: created })];
        return {
          status: 200,
          json: { metadata: { "@type": INDEX_META, index: created }, name: opName },
        };
      }
      if (r.url.endsWith(`/${opName}`))
        return {
          status: 200,
          json: {
            done: true,
            metadata: { "@type": INDEX_META, index: different },
            name: opName,
            response: {},
          },
        };
      return undefined;
    },
  });
  const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  assert.equal(result.entries.E1.write.target, created);
  assert.equal(result.entries.E1.operation, "unreadable");
  assert.notEqual(result.entries.E1.outcome, "created");
  // The same operation naming the created index settles it.
  assert.equal(
    operationState(
      {
        status: 200,
        json: {
          done: true,
          metadata: { "@type": INDEX_META, index: created },
          name: opName,
          response: {},
        },
      },
      opName,
      FORMS,
      ENTRIES.E1,
      created,
    ),
    "done",
  );
  // A list that shows another index than the one created does not make it created either.
  const other = fakeFirestore({
    fail: (r) =>
      r.method === "GET" &&
      r.url.includes("/-/indexes") &&
      other.requests.some((q) => q.method === "POST")
        ? { status: 200, json: { indexes: [listedIndex("imx", { name: different })] } }
        : undefined,
  });
  const second = await apply({ session: session(other), set: "f1", forms: FORMS, sleep: noSleep });
  assert.equal(second.entries.E1.operation, "done");
  assert.notEqual(second.entries.E1.outcome, "created");
});

test("every key production records on index and field operations is accepted", () => {
  const name = `${DB}/operations/op9`;
  const fieldMeta = {
    "@type": FIELD_META,
    field: E4_NAME,
    state: "SUCCESSFUL",
    startTime: "t",
    endTime: "t",
    indexConfigDeltas: [],
    progressDocuments: {},
    progressBytes: {},
    ttlConfigDelta: {},
  };
  assert.equal(
    operationState(
      { status: 200, json: { done: true, metadata: fieldMeta, name, response: {} } },
      name,
      FORMS,
      ENTRIES.E4,
      E4_NAME,
    ),
    "done",
  );
  const index = `${DB}/collectionGroups/imc/indexes/CICAgimc`;
  const indexMeta = {
    "@type": INDEX_META,
    index,
    state: "SUCCESSFUL",
    startTime: "t",
    endTime: "t",
    progressDocuments: {},
    progressBytes: {},
  };
  assert.equal(
    operationState(
      { status: 200, json: { done: true, metadata: indexMeta, name, response: {} } },
      name,
      FORMS,
      ENTRIES.E2,
      index,
    ),
    "done",
  );
  assert.equal(
    operationState(
      {
        status: 200,
        json: {
          done: true,
          metadata: { ...indexMeta, outputUriPrefix: "gs://x" },
          name,
          response: {},
        },
      },
      name,
      FORMS,
      ENTRIES.E2,
      index,
    ),
    "unreadable",
    "a key of another operation type",
  );
  assert.equal(
    operationState(
      {
        status: 200,
        json: { done: true, metadata: { ...indexMeta, ttlConfigDelta: {} }, name, response: {} },
      },
      name,
      FORMS,
      ENTRIES.E2,
      index,
    ),
    "unreadable",
    "a field-operation key on an index operation",
  );
});

test("main never reaches for the real token when the http layer is injected", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-config-token-"));
  try {
    const out = join(root, "x");
    const fake = fakeFirestore();
    assert.equal(await main(["status", "--set", "all", "--out", out], { http: fake.http }), 3);
    assert.deepEqual(fake.requests, []);
    await assert.rejects(readFile(join(out, "result.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operation targets are compared as exact strings, and unknown metadata types are unreadable", async () => {
  const name = `${DB}/operations/op9`;
  const answer = (metadata) => ({
    status: 200,
    json: { done: true, metadata, name, response: {} },
  });
  // The same field in the project-number form is not the exact name the reset answer gave.
  assert.equal(
    operationState(
      answer({ "@type": FIELD_META, field: `${DB_NUMBER}/collectionGroups/imx/fields/a` }),
      name,
      FORMS,
      ENTRIES.E4,
      E4_NAME,
    ),
    "unreadable",
  );
  for (const type of [
    "type.googleapis.com/google.firestore.admin.v1.ExportDocumentsMetadata",
    "x",
    undefined,
  ])
    assert.equal(
      operationState(answer({ "@type": type, field: E4_NAME }), name, FORMS, ENTRIES.E4, E4_NAME),
      "unreadable",
      String(type),
    );
  // A create answer naming another group's index carries no operation, so it is never polled.
  let posted = false;
  const fake = fakeFirestore({
    fail: (r) =>
      r.method === "POST" && r.url.includes("/imx/indexes") && !posted
        ? async () => {
            posted = true;
            await fake.http(r);
            return {
              status: 200,
              json: {
                metadata: {
                  "@type": INDEX_META,
                  index: `${DB_NUMBER}/collectionGroups/imc/indexes/Z`,
                },
                name: `${DB_NUMBER}/operations/opY`,
              },
            };
          }
        : undefined,
  });
  const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  assert.equal(result.entries.E1.write.class, "done");
  assert.equal(result.entries.E1.write.operation, undefined);
  assert.equal(fake.requests.filter((r) => r.url.endsWith("/opY")).length, 0);
  assert.equal(result.entries.E1.outcome, "created", "settled by its own READY read");
});

// ---- packet v6 (coordinator ruling 6) ------------------------------------------------------

test("entries are read from the database-wide list the base lane uses, by their own group", async () => {
  const fake = fakeFirestore();
  const before = await status({ session: session(fake), set: "all", forms: FORMS });
  assert.equal(before.baseline, true, "24 indexes of other groups are not the entries");
  const lists = fake.requests.filter((r) => r.url.includes("/indexes"));
  assert.equal(lists.length, 2);
  for (const r of lists) assert.equal(r.url, `${API}/${DB}/collectionGroups/-/indexes`);
  const applied = await apply({ session: session(fake), set: "all", forms: FORMS, sleep: noSleep });
  assert.equal(applied.ok, true);
  for (const id of ["E1", "E2"]) assert.equal(applied.entries[id].outcome, "created", id);
  fake.requests.length = 0;
  const removed = await remove({
    session: session(fake),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
    ...fromJournals([`${JSON.stringify({ result: { command: "apply", ...applied } })}\n`]),
  });
  assert.equal(removed.ok, true);
  const deletes = fake.requests
    .filter((r) => r.method === "DELETE")
    .map((r) => r.url.split("/collectionGroups/")[1]);
  assert.deepEqual(deletes, ["imx/indexes/CICAgimx", "imc/indexes/CICAgimc"]);
  assert.equal(
    fake.state.others.length,
    BASE_INDEXES.length,
    "no index of another group is touched",
  );
});

test("an index of another group is never an entry, even with the entry's exact fields", async () => {
  const lookalike = listedIndex("qx", { name: `${DB_NUMBER}/collectionGroups/qx/indexes/LOOK` });
  const fake = fakeFirestore({ others: [...BASE_INDEXES, lookalike] });
  assert.equal(
    entryState(ENTRIES.E1, { status: 200, json: { indexes: fake.state.others } }, FORMS).state,
    "absent",
  );
  const result = await remove({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  assert.equal(result.refusedBeforeSending, undefined);
  assert.equal(fake.requests.filter((r) => r.method === "DELETE").length, 0);
});

test("every index of the list must have a well-formed name of this database", () => {
  const read = (extra) =>
    entryState(ENTRIES.E1, { status: 200, json: { indexes: [...BASE_INDEXES, extra] } }, FORMS);
  for (const [label, index] of [
    [
      "another project",
      {
        ...BASE_INDEXES[0],
        name: "projects/other/databases/(default)/collectionGroups/qx/indexes/A",
      },
    ],
    [
      "another database",
      {
        ...BASE_INDEXES[0],
        name: `${DB_NUMBER}`.replace("(default)", "named") + "/collectionGroups/qx/indexes/A",
      },
    ],
    ["no name", { ...BASE_INDEXES[0], name: undefined }],
    [
      "a malformed id",
      { ...BASE_INDEXES[0], name: `${DB_NUMBER}/collectionGroups/qx/indexes/a/b` },
    ],
    ["an extra key", { ...BASE_INDEXES[0], multikey: true }],
    ["not an object", "x"],
  ])
    assert.equal(read(JSON.parse(JSON.stringify(index))).state, "unexpected", label);
  // Two indexes in the entry's own group, or one of the wrong shape there, are unexpected.
  assert.equal(read(listedIndex("imx")).state, "present");
  assert.equal(
    entryState(
      ENTRIES.E1,
      {
        status: 200,
        json: {
          indexes: [
            ...BASE_INDEXES,
            listedIndex("imx"),
            listedIndex("imx", { name: `${DB_NUMBER}/collectionGroups/imx/indexes/Y` }),
          ],
        },
      },
      FORMS,
    ).state,
    "unexpected",
  );
  assert.equal(read(listedIndex("imx", { queryScope: "COLLECTION_GROUP" })).state, "unexpected");
});

test("the inherited field read recorded at the v5.1 begin reads absent", () => {
  // send-v5/status-begin seq 1, key order as answered, the project as its id.
  const json = {
    name: `${DB}/collectionGroups/ima/fields/a`,
    indexConfig: {
      indexes: [
        {
          queryScope: "COLLECTION",
          fields: [{ fieldPath: "a", order: "ASCENDING" }],
          state: "READY",
        },
        {
          queryScope: "COLLECTION",
          fields: [{ fieldPath: "a", order: "DESCENDING" }],
          state: "READY",
        },
        {
          queryScope: "COLLECTION",
          fields: [{ fieldPath: "a", arrayConfig: "CONTAINS" }],
          state: "READY",
        },
      ],
      usesAncestorConfig: true,
      ancestorField: `${DB}/collectionGroups/__default__/fields/*`,
    },
  };
  assert.equal(entryState(ENTRIES.E3, { status: 200, json }, FORMS).state, "absent");
});

test("main exits non-zero when status cannot read every entry, as at the v5.1 begin", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-config-status-"));
  try {
    // Two indexes in imx: the entry cannot be read, so status is not ok.
    const fake = fakeFirestore({
      composites: {
        imx: [
          listedIndex("imx"),
          listedIndex("imx", { name: `${DB_NUMBER}/collectionGroups/imx/indexes/Y` }),
        ],
      },
    });
    const out = join(root, "status");
    const code = await main(["status", "--set", "all", "--out", out], {
      http: fake.http,
      token: async () => "t",
    });
    assert.equal(code, 2);
    const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
    assert.equal(result.ok, false);
    assert.equal(result.baseline, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---- packet v7 (coordinator ruling 7) ------------------------------------------------------

/** The whole send's config steps against one fake; the states and outcomes it reached. */
async function cycle(fake) {
  const before = await status({
    session: session(fake, requestCap("status", "all")),
    set: "all",
    forms: FORMS,
  });
  const applied = await apply({
    session: session(fake, requestCap("apply", "all")),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
  });
  const during = await status({
    session: session(fake, requestCap("status", "all")),
    set: "all",
    forms: FORMS,
  });
  const removed = await remove({
    session: session(fake, requestCap("remove", "all")),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
    ...fromJournals([`${JSON.stringify({ result: { command: "apply", ...applied } })}\n`]),
  });
  const after = await status({
    session: session(fake, requestCap("status", "all")),
    set: "all",
    forms: FORMS,
  });
  const shape = (r) =>
    Object.fromEntries(
      Object.entries(r.states ?? r.entries).map(([id, e]) => [id, e.state ?? e.outcome]),
    );
  return {
    before: shape(before),
    applied: shape(applied),
    during: shape(during),
    removed: shape(removed),
    after: shape(after),
    ok: [before.baseline, applied.ok, during.applied, removed.ok, after.baseline],
  };
}

test("the recorded 24 plus the two created read the same in one, two and five pages", async () => {
  const one = await cycle(fakeFirestore());
  assert.deepEqual(one.ok, [true, true, true, true, true]);
  for (const pageSize of [13, 6]) {
    const fake = fakeFirestore({ pageSize });
    const paged = await cycle(fake);
    assert.deepEqual(paged, one, `page size ${pageSize}`);
    const pages = fake.requests.filter((r) => r.url.includes("/-/indexes?pageToken="));
    assert.ok(pages.length > 0, `page size ${pageSize} followed its pages`);
    for (const r of pages)
      assert.match(
        r.url,
        new RegExp(
          `^${API.replaceAll(".", "\\.")}/${DB.replace("(", "\\(").replace(")", "\\)")}/collectionGroups/-/indexes\\?pageToken=t\\d+$`,
        ),
      );
  }
  // 26 composites in pages of 6 are five pages: the last read after apply takes all five.
  const five = fakeFirestore({ pageSize: 6 });
  await apply({ session: session(five), set: "all", forms: FORMS, sleep: noSleep });
  five.requests.length = 0;
  await status({ session: session(five), set: "f1", forms: FORMS });
  assert.equal(five.requests.filter((r) => r.url.includes("/-/indexes")).length, 2 * 5);
});

test("a sixth page, a repeated, empty or non-string token, or a bad later page sends nothing", async () => {
  const states = async (fake) => {
    const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
    assert.equal(result.refusedBeforeSending, true);
    assert.deepEqual(writesOf(fake), []);
    const removal = await remove({
      session: session(fake),
      set: "f1",
      forms: FORMS,
      sleep: noSleep,
    });
    assert.equal(removal.refusedBeforeSending, true);
    assert.deepEqual(writesOf(fake), []);
    return result.before.E1;
  };
  // 24 in pages of 4: six pages.
  assert.match((await states(fakeFirestore({ pageSize: 4 }))).reason, /more than 5 pages/);
  const second = (json) => (r) =>
    r.method === "GET" && r.url.includes("/-/indexes?pageToken=t12")
      ? { status: 200, json }
      : undefined;
  for (const [label, page2, expected] of [
    [
      "a repeated token",
      { indexes: BASE_INDEXES.slice(12, 13), nextPageToken: "t12" },
      "unexpected",
    ],
    ["an empty token", { indexes: BASE_INDEXES.slice(12, 13), nextPageToken: "" }, "unexpected"],
    ["a numeric token", { indexes: BASE_INDEXES.slice(12, 13), nextPageToken: 7 }, "unexpected"],
    ["a null token", { indexes: BASE_INDEXES.slice(12, 13), nextPageToken: null }, "unexpected"],
    ["an object token", { indexes: BASE_INDEXES.slice(12, 13), nextPageToken: {} }, "unexpected"],
    ["null indexes on page 2", { indexes: null }, "unexpected"],
    [
      "a foreign name on page 2",
      {
        indexes: [
          {
            ...BASE_INDEXES[12],
            name: "projects/other/databases/(default)/collectionGroups/qx/indexes/A",
          },
        ],
      },
      "unexpected",
    ],
    ["an extra key on page 2", { indexes: BASE_INDEXES.slice(12), extra: 1 }, "unexpected"],
  ]) {
    const fake = fakeFirestore({ pageSize: 12, fail: second(page2) });
    assert.equal((await states(fake)).state, expected, label);
  }
  // The repeated token is refused as such, after two pages, not by running into the cap.
  const repeated = fakeFirestore({
    pageSize: 12,
    fail: second({ indexes: BASE_INDEXES.slice(12, 13), nextPageToken: "t12" }),
  });
  const read = await readStates(session(repeated), "x", ["E1"], FORMS);
  assert.equal(read.E1.reason, "a page token that is not a new non-empty string");
  assert.equal(repeated.requests.length, 2);
  const unreadable = fakeFirestore({
    pageSize: 12,
    fail: (r) =>
      r.method === "GET" && r.url.includes("pageToken=") ? { status: 503, json: {} } : undefined,
  });
  assert.equal((await states(unreadable)).state, "unreadable");
  // An empty token on the first page is no better than on a later one.
  const first = fakeFirestore({
    fail: (r) =>
      r.method === "GET" && r.url.endsWith("/-/indexes")
        ? { status: 200, json: { indexes: BASE_INDEXES, nextPageToken: "" } }
        : undefined,
  });
  assert.equal((await states(first)).state, "unexpected");
});

test("a page token goes back only as the encoded pageToken of the fixed list URL", async () => {
  const token = "a/b+c==?&#'!(x)*% z";
  const urls = [];
  const http = async (r) => {
    urls.push(r.url);
    return urls.length === 1
      ? { status: 200, json: { indexes: BASE_INDEXES.slice(0, 1), nextPageToken: token } }
      : { status: 200, json: { indexes: BASE_INDEXES.slice(1) } };
  };
  const read = await readStates(
    createSession({ http, token: async () => "t", cap: 10, wallMs: 60_000 }),
    "x",
    ["E1"],
    FORMS,
  );
  assert.equal(read.E1.state, "absent");
  assert.equal(urls[1].split("?")[0], `${API}/${DB}/collectionGroups/-/indexes`);
  assert.equal(new URL(urls[1]).searchParams.get("pageToken"), token);
  assert.equal(new URL(urls[1]).search.split("&").length, 1, "one parameter");
  // The production layer sends that URL as it is (its href check holds for the encoded form).
  const sent = [];
  const prod = productionHttp({ [SEND_FLAG]: SEND_FLAG_VALUE }, async (url) => {
    sent.push(url);
    return { status: 200, text: async () => "{}" };
  });
  await prod({ method: "GET", url: urls[1], token: "t" });
  assert.deepEqual(sent, [urls[1]]);
});

test("an entry on an earlier page than the last is still found", async () => {
  const fake = fakeFirestore({ others: [], pageSize: 1 });
  const applied = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  assert.equal(applied.ok, true);
  const read = await status({ session: session(fake), set: "f1", forms: FORMS });
  assert.equal(read.applied, true, "imx on page 1, imc on page 2");
});

// ---- stage B (coordinator ruling 8 item 5) -------------------------------------------------

test("an operation whose metadata type cannot become a string is unreadable for its entry", async () => {
  const name = `${DB}/operations/op9`;
  const weird = JSON.parse('{"toString": 1, "valueOf": 2}');
  const answer = {
    status: 200,
    json: { done: true, metadata: { "@type": weird, field: E4_NAME }, name, response: {} },
  };
  assert.equal(operationState(answer, name, FORMS, ENTRIES.E4, E4_NAME), "unreadable");
  // In apply, after the writes: the entry's operation is unreadable and apply still settles.
  const fake = fakeFirestore({
    fail: (r) =>
      r.url.includes("/operations/")
        ? {
            status: 200,
            json: {
              done: true,
              metadata: { "@type": JSON.parse('{"toString": 1}') },
              name: r.url.slice(API.length + 1),
              response: {},
            },
          }
        : undefined,
  });
  const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  for (const id of SETS.f1) assert.equal(result.entries[id].operation, "unreadable", id);
  assert.equal(result.ok, false);
});

// ---- ruling 9 item 4 -------------------------------------------------------------------------

test("a create or reset answer whose operation cannot be classified stops the writes", async () => {
  const weird = () => JSON.parse('{"toString": 1, "valueOf": 2}');
  // apply: the first create (E1) answers 200 with an unclassifiable operation.
  const fake = fakeFirestore();
  let posted = false;
  const wrapped = async (r) => {
    const answer = await fake.http(r);
    if (r.method === "POST" && !posted) {
      posted = true;
      return {
        status: 200,
        json: { ...answer.json, metadata: { ...answer.json.metadata, "@type": weird() } },
      };
    }
    return answer;
  };
  const result = await apply({
    session: createSession({ http: wrapped, token: async () => "t", cap: 1000, wallMs: 3_600_000 }),
    set: "f1",
    forms: FORMS,
    sleep: noSleep,
  });
  assert.equal(writesOf(fake).length, 1, "no write after the unclassifiable answer");
  assert.equal(result.entries.E1.write.unclassified, true);
  for (const id of ["E2", "E4", "E5"]) assert.equal(result.entries[id].write.class, "not-sent", id);
  assert.equal(result.ok, false);
  // remove: the first reset (E3) answers 200 with an unclassifiable operation.
  const { fake: applied } = await appliedFake();
  applied.requests.length = 0;
  let reset = false;
  const http = async (r) => {
    if (r.method === "PATCH" && !reset) {
      reset = true;
      const answer = await applied.http(r);
      return {
        status: 200,
        json: { ...answer.json, metadata: { ...answer.json.metadata, "@type": weird() } },
      };
    }
    return applied.http(r);
  };
  const removal = await remove({
    session: createSession({ http, token: async () => "t", cap: 1000, wallMs: 3_600_000 }),
    set: "all",
    forms: FORMS,
    sleep: noSleep,
  });
  assert.equal(applied.requests.filter((r) => r.method !== "GET").length, 1, "no write after it");
  assert.equal(removal.entries.E3.write.unclassified, true);
  assert.equal(removal.ok, false);
});

// ---- ruling 10 item 4 ------------------------------------------------------------------------

test("a done create or reset is accepted only as a readable operation of its entry", async () => {
  const variants = {
    "unknown string type": (meta) => ({ ...meta, "@type": "unknown" }),
    "another admin type": (meta) => ({
      ...meta,
      "@type": "type.googleapis.com/google.firestore.admin.v1.ExportDocumentsMetadata",
    }),
    "no metadata": () => undefined,
    "another target": (meta) => ({
      ...meta,
      index: `${DB}/collectionGroups/imc/indexes/Z`,
      field: `${DB}/collectionGroups/imc/fields/zz`,
    }),
  };
  const replaced = (answer, change) => {
    const { metadata, ...rest } = answer.json;
    const changed = change(metadata);
    return { status: 200, json: changed === undefined ? rest : { ...rest, metadata: changed } };
  };
  for (const [label, change] of Object.entries(variants)) {
    // apply: the first create (E1) answers 200 with that body.
    const fake = fakeFirestore();
    let posted = false;
    const wrapped = async (r) => {
      const answer = await fake.http(r);
      if (r.method === "POST" && !posted) {
        posted = true;
        return replaced(answer, change);
      }
      return answer;
    };
    const result = await apply({
      session: createSession({
        http: wrapped,
        token: async () => "t",
        cap: 1000,
        wallMs: 3_600_000,
      }),
      set: "f1",
      forms: FORMS,
      sleep: noSleep,
    });
    assert.equal(writesOf(fake).length, 1, `${label}: no write after it`);
    assert.equal(result.entries.E1.write.unclassified, true, label);
    for (const id of ["E2", "E4", "E5"])
      assert.equal(result.entries[id].write.class, "not-sent", `${label} ${id}`);
    // remove: the first reset (E3) answers 200 with that body.
    const { fake: applied } = await appliedFake();
    applied.requests.length = 0;
    let reset = false;
    const http = async (r) => {
      const answer = await applied.http(r);
      if (r.method === "PATCH" && !reset) {
        reset = true;
        return replaced(answer, change);
      }
      return answer;
    };
    const removal = await remove({
      session: createSession({ http, token: async () => "t", cap: 1000, wallMs: 3_600_000 }),
      set: "all",
      forms: FORMS,
      sleep: noSleep,
    });
    const writes = applied.requests.filter((r) => r.method !== "GET");
    assert.deepEqual(
      writes.map((r) => r.method),
      ["PATCH"],
      `${label}: no write after the reset`,
    );
    assert.equal(removal.entries.E3.write.unclassified, true, label);
    assert.equal(removal.ok, false, label);
  }
  // The recorded answers are accepted: apply writes every entry.
  const fake = fakeFirestore();
  const result = await apply({ session: session(fake), set: "f1", forms: FORMS, sleep: noSleep });
  for (const id of SETS.f1) assert.equal(result.entries[id].write.unclassified, undefined, id);
  assert.equal(result.ok, true);
});
