// The index-merge observation lane (shapes F1 to F3 of the Lean index-merge model): its own lane
// entry, its corpus, and its index file, which is the FS-QUERY-INDEX lane file plus entries on
// collection groups nothing else uses. Nothing here sends a request.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROGRAMS as LIST_PROGRAMS } from "./fs-list/corpus.mjs";
import { PROGRAMS as QUERY_PROGRAMS } from "./fs-query-index/corpus.mjs";
import {
  GROUPS,
  MERGE_LANE,
  MERGE_PREFIX,
  PROGRAMS,
  ROWS,
  seedFor,
} from "./fs-query-index-merge/corpus.mjs";
import { buildRestRequest, createContext, validateCorpus } from "./fs-query-index/harness.mjs";
import { LANES, selectLane } from "./fs-query-index/lanes.mjs";
import {
  ceilings,
  estimatedUsd,
  indexKey,
  MAX_LIST_PAGES,
  productionIndexes,
  programDigest,
  selectPrograms,
} from "./fs-query-index/run.mjs";

const readJson = (path) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));

/** What the merge lane's index file adds to the FS-QUERY-INDEX lane file, exactly. */
const ADDED_INDEXES = [
  {
    collectionGroup: "imx",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "a", order: "ASCENDING" },
      { fieldPath: "tags", arrayConfig: "CONTAINS" },
    ],
  },
  {
    collectionGroup: "imc",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "a", order: "ASCENDING" },
      { fieldPath: "tags", arrayConfig: "CONTAINS" },
    ],
  },
];
const ADDED_OVERRIDES = [
  {
    collectionGroup: "ima",
    fieldPath: "a",
    indexes: [{ queryScope: "COLLECTION", order: "ASCENDING" }],
  },
  { collectionGroup: "imx", fieldPath: "a", indexes: [] },
  { collectionGroup: "imx", fieldPath: "tags", indexes: [] },
];

const text = (value) => JSON.stringify(value);
const stepsOf = (programs) => programs.flatMap((p) => p.steps.map((s) => [p, s]));

test("the merge lane is its own entry and leaves the lanes sharing its harness alone", () => {
  const lane = LANES[MERGE_LANE];
  assert.equal(MERGE_LANE, "fs-query-index-merge");
  assert.equal(selectLane(MERGE_LANE), lane);
  assert.equal(lane.id, MERGE_LANE);
  assert.equal(lane.taskId, "FS-QUERY-INDEX-MERGE");
  assert.equal(lane.corpus, "../fs-query-index-merge/corpus.mjs");
  assert.equal(lane.fixture, "fs-query-index-merge-production.json");
  assert.equal(lane.indexes, "fs-query-index-merge.indexes.json");
  assert.equal(lane.localConfig, "fs-query-index-merge.fireemu.json");
  assert.equal(lane.harness, "src/fs-query-index");
  assert.deepEqual(lane.sources, ["src/fs-query-index", "src/fs-query-index-merge"]);
  assert.equal(lane.database, undefined, "the lane records into (default)");
  assert.equal(lane.firebaseJson, undefined);
  assert.equal(lane.divergences, undefined, "no approved divergence applies to these rows");
  // The lanes whose recorded harness digest reads fs-query-index.indexes.json keep it.
  for (const id of ["fs-query-index", "fs-data-write-list"]) {
    assert.equal(LANES[id].indexes, "fs-query-index.indexes.json", id);
    assert.equal(LANES[id].localConfig, "fs-query-index.fireemu.json", id);
  }
  const others = Object.values(LANES).filter((l) => l !== lane);
  for (const key of ["fixture", "taskId", "corpus"])
    assert.ok(!others.some((l) => l[key] === lane[key]), `${key} is the lane's own`);
});

test("programs validate only under the lane prefix and have their own digests", () => {
  assert.equal(validateCorpus(PROGRAMS, MERGE_LANE), 24);
  assert.throws(() => validateCorpus(PROGRAMS), /program id must be fs-query-index\//);
  for (const p of PROGRAMS) assert.ok(p.id.startsWith(`${MERGE_PREFIX}shapes/`), p.id);
  assert.deepEqual(selectPrograms(PROGRAMS, MERGE_PREFIX), PROGRAMS);
  assert.equal(new Set(PROGRAMS.map(programDigest)).size, PROGRAMS.length);
  assert.deepEqual(
    PROGRAMS.map((p) => [p.id, p.steps.length]),
    [
      ["fs-query-index-merge/shapes/builtin", 7],
      ["fs-query-index-merge/shapes/ascending-only", 8],
      ["fs-query-index-merge/shapes/exempt-with-composite", 7],
      ["fs-query-index-merge/shapes/composite-not-exempt", 2],
    ],
  );
});

test("the request bound and the cost estimate of two recordings", () => {
  // Per recording: 24 recorded steps, and 20 + 4 x (8 + 2) = 60 harness requests at most.
  assert.deepEqual(ceilings(PROGRAMS), { maxRequests: 24, maxHarnessRequests: 60 });
  assert.equal(estimatedUsd(PROGRAMS, 2), 0.0016);
});

test("each probe is the exact Lean counterexample shape, on its own configuration", () => {
  const lane = readJson("fs-query-index-merge.indexes.json");
  const probes = stepsOf(PROGRAMS).filter(([, s]) => !s.id.endsWith("-plan"));
  const byShape = (shape) =>
    ROWS.filter(([, , kind, , role]) => kind === shape && role === "probe").map(([id, config]) =>
      probes.find(([p, s]) => s.id === id && p.id.endsWith(programOf(config))),
    );
  const where = (s) => s.body.structuredQuery.where;
  const order = (s) => s.body.structuredQuery.orderBy;
  const filters = (s) =>
    (where(s).compositeFilter?.filters ?? [where(s)]).map((x) => [
      x.fieldFilter.field.fieldPath,
      x.fieldFilter.op,
    ]);
  const [[, f1]] = byShape("F1");
  assert.deepEqual(filters(f1), [
    ["a", "EQUAL"],
    ["b", "EQUAL"],
    ["tags", "ARRAY_CONTAINS"],
  ]);
  assert.equal(order(f1), undefined);
  assert.equal(f1.body.structuredQuery.from[0].collectionId, "imx");
  const [[, f2]] = byShape("F2");
  assert.deepEqual(filters(f2), [
    ["a", "EQUAL"],
    ["b", "EQUAL"],
  ]);
  assert.deepEqual(order(f2), [{ field: { fieldPath: "__name__" }, direction: "DESCENDING" }]);
  assert.equal(f2.body.structuredQuery.from[0].collectionId, "ima");
  const [[, f3]] = byShape("F3");
  assert.deepEqual(filters(f3), [
    ["a", "EQUAL"],
    ["tags", "ARRAY_CONTAINS"],
  ]);
  assert.deepEqual(order(f3), [{ field: { fieldPath: "__name__" }, direction: "DESCENDING" }]);
  assert.equal(f3.body.structuredQuery.from[0].collectionId, "imb");
  // The configurations: F2 has a's ascending collection index only, F1 the composite with a and
  // tags exempt, F3 and the built-in controls nothing at all.
  const overridesOf = (group) => lane.fieldOverrides.filter((o) => o.collectionGroup === group);
  const compositesOf = (group) => lane.indexes.filter((i) => i.collectionGroup === group);
  assert.deepEqual(overridesOf("imb"), []);
  assert.deepEqual(compositesOf("imb"), []);
  assert.deepEqual(overridesOf("ima"), [ADDED_OVERRIDES[0]]);
  assert.deepEqual(compositesOf("ima"), []);
  assert.deepEqual(overridesOf("imx"), ADDED_OVERRIDES.slice(1));
  assert.deepEqual(compositesOf("imx"), [ADDED_INDEXES[0]]);
  assert.deepEqual(overridesOf("imc"), []);
  assert.deepEqual(compositesOf("imc"), [ADDED_INDEXES[1]]);
  // Every probe has its plan-only Explain twin, and nothing else is explained.
  const plans = stepsOf(PROGRAMS).filter(([, s]) => s.id.endsWith("-plan"));
  assert.deepEqual(
    plans.map(([, s]) => s.id),
    [
      "f3-contains-name-desc-plan",
      "f2-equalities-name-desc-plan",
      "f1-equalities-and-contains-plan",
    ],
  );
  for (const [p, plan] of plans) {
    const twin = p.steps.find((s) => s.id === plan.id.replace(/-plan$/, ""));
    assert.deepEqual(plan.body, { ...twin.body, explainOptions: {} });
  }
});

/** The program id suffix of each configuration. */
function programOf(config) {
  return {
    builtin: "/builtin",
    ascOnly: "/ascending-only",
    exemptComposite: "/exempt-with-composite",
    compositeOnly: "/composite-not-exempt",
  }[config];
}

test("the rows are the coverage table: one step per combination, in its program", () => {
  // The combinations the coverage ledger's PICT model enumerates (all valid ones, order 4).
  assert.equal(ROWS.length, 21);
  assert.equal(new Set(ROWS.map(([id, config]) => `${config}#${id}`)).size, ROWS.length);
  for (const [id, config, kind, direction] of ROWS) {
    const program = PROGRAMS.find((p) => p.id.endsWith(programOf(config)));
    const step = program.steps.find((s) => s.id === id);
    assert.ok(step, `${config}#${id}`);
    const sq = step.body.structuredQuery;
    assert.equal(sq.from[0].collectionId, GROUPS[config]);
    assert.deepEqual(sq.select, { fields: [{ fieldPath: "c" }] });
    const ordered = kind === "orderA" ? "a" : "__name__";
    if (direction === "none") assert.equal(sq.orderBy, undefined, id);
    else
      assert.deepEqual(sq.orderBy, [
        {
          field: { fieldPath: ordered },
          direction: direction === "asc" ? "ASCENDING" : "DESCENDING",
        },
      ]);
  }
});

test("each program seeds and reads only its own group, which nothing else names", () => {
  const groups = Object.values(GROUPS);
  assert.equal(new Set(groups).size, groups.length);
  for (const program of PROGRAMS) {
    const group = program.steps[0].body.structuredQuery.from[0].collectionId;
    assert.deepEqual(program.seed, seedFor(group));
    for (const [name] of program.seed) assert.match(name, new RegExp(`^${group}/x[0-7]$`));
    for (const step of program.steps) {
      assert.equal(step.rpc, "runQuery");
      assert.equal(step.transport, undefined, "REST");
      assert.equal(step.parent, undefined, "the documents root");
      assert.deepEqual(step.body.structuredQuery.from, [{ collectionId: group }]);
    }
  }
  // No other corpus seeds or queries these groups, and no other index file names them.
  const otherText = text([QUERY_PROGRAMS, LIST_PROGRAMS]);
  for (const group of groups) {
    assert.ok(!otherText.includes(`"${group}/`), `${group} is seeded elsewhere`);
    assert.ok(!otherText.includes(`"collectionId":"${group}"`), `${group} is queried elsewhere`);
  }
  for (const file of ["fs-query-index.indexes.json", "firestore.indexes.json"]) {
    const other = readJson(file);
    const named = new Set(
      [...other.indexes, ...(other.fieldOverrides ?? [])].map((i) => i.collectionGroup),
    );
    for (const group of groups) assert.ok(!named.has(group), `${file} names ${group}`);
  }
});

test("the seeded answers: every merge answer has several rows", () => {
  const docs = seedFor("g").map(([name, fields]) => Object.assign({ name }, fields));
  const value = (v) => Number(v.integerValue);
  const has = (d, n) => d.tags.arrayValue.values.some((v) => value(v) === n);
  const names = (pred) => docs.filter(pred).map((d) => d.name);
  assert.deepEqual(
    names((d) => value(d.a) === 1 && value(d.b) === 1),
    ["g/x3", "g/x7"],
  );
  assert.deepEqual(
    names((d) => value(d.a) === 1 && has(d, 1)),
    ["g/x1", "g/x3", "g/x7"],
  );
  assert.deepEqual(
    names((d) => value(d.a) === 1 && value(d.b) === 1 && has(d, 1)),
    ["g/x3", "g/x7"],
  );
  assert.ok(names((d) => value(d.a) === 1 && !has(d, 1)).length > 0, "tags filters something");
});

test("the merge index file is the FS-QUERY-INDEX lane file plus the merge entries, exactly", () => {
  const base = readJson("fs-query-index.indexes.json");
  const lane = readJson("fs-query-index-merge.indexes.json");
  assert.deepEqual(Object.keys(lane), Object.keys(base));
  assert.deepEqual(lane.indexes, [...base.indexes, ...ADDED_INDEXES]);
  assert.deepEqual(lane.fieldOverrides, [...base.fieldOverrides, ...ADDED_OVERRIDES]);
  // Nothing added is equivalent to an index already deployed (the verify-indexes key).
  const key = (i) => indexKey(i.collectionGroup, i.queryScope, i.fields);
  const keys = lane.indexes.map(key);
  assert.equal(new Set(keys).size, keys.length);
  // The preflight's own rule: the lane file holds every shared index.
  const shared = readJson("firestore.indexes.json");
  for (const index of shared.indexes) assert.ok(keys.includes(key(index)), text(index));
});

test("the local configuration is the FS-QUERY-INDEX one with the merge index file", () => {
  const base = readJson("fs-query-index.fireemu.json");
  const config = readJson("fs-query-index-merge.fireemu.json");
  assert.deepEqual(config, {
    ...base,
    firestore: { ...base.firestore, indexFile: "conformance/fs-query-index-merge.indexes.json" },
  });
});

test("a production request addresses only the sandbox (default) database", () => {
  const ctx = createContext({
    run: "1",
    startedMs: Date.parse("2026-11-19T00:00:00Z"),
    target: { kind: "production", token: "ya29.secret", quotaProject: "fireemu-oracle-query" },
  });
  for (const [, step] of stepsOf(PROGRAMS)) {
    const { url, init } = buildRestRequest(step, ctx, new Map());
    assert.equal(
      url,
      "https://firestore.googleapis.com/v1/projects/fireemu-oracle-query/databases/(default)/documents:runQuery",
    );
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-goog-user-project"], "fireemu-oracle-query");
  }
});

test("the preflight's index lists stop after MAX_LIST_PAGES pages each", async () => {
  assert.equal(MAX_LIST_PAGES, 5);
  const urls = [];
  const endless = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ indexes: [{}], nextPageToken: "p" }) };
  };
  await assert.rejects(productionIndexes("t", endless), /more than 5 pages/);
  assert.equal(urls.length, MAX_LIST_PAGES);
  urls.length = 0;
  const pages = { indexes: 2, fields: 3 };
  const finite = async (url) => {
    urls.push(url);
    const kind = url.includes("/indexes") ? "indexes" : "fields";
    pages[kind] -= 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        [kind]: [{ k: kind }],
        ...(pages[kind] > 0 ? { nextPageToken: "n" } : {}),
      }),
    };
  };
  const { composites, overrides } = await productionIndexes("t", finite);
  assert.equal(composites.length, 2);
  assert.equal(overrides.length, 3);
  assert.equal(urls.length, 5);
  // The field list already carries ?filter=, so a later page appends &pageToken=.
  const fieldPages = urls.filter((u) => u.includes("/fields"));
  assert.ok(
    fieldPages.slice(1).every((u) => u.includes("&pageToken=n") && u.split("?").length === 2),
  );
  assert.ok(urls.filter((u) => u.includes("/indexes"))[1].includes("/indexes?pageToken=n"));
});
