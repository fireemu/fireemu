// The second index-merge observation lane (observation 2a): its own lane entry, its corpus (the
// coverage table of its PICT axes, one step per valid combination) and its index file,
// which is the first merge lane's file plus three collection-group overrides on groups nothing
// else uses. Nothing here sends a request.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROGRAMS as LIST_PROGRAMS } from "./fs-list/corpus.mjs";
import { PROGRAMS as QUERY_PROGRAMS } from "./fs-query-index/corpus.mjs";
import { PROGRAMS as MERGE_PROGRAMS, seedFor } from "./fs-query-index-merge/corpus.mjs";
import {
  CONFIGS,
  LANE_ID,
  LANE_PREFIX,
  PROGRAMS,
  ROWS,
  stepId,
} from "./fs-query-index-merge2/corpus.mjs";
import { buildRestRequest, createContext, validateCorpus } from "./fs-query-index/harness.mjs";
import { LANES, selectLane } from "./fs-query-index/lanes.mjs";
import {
  ceilings,
  estimatedUsd,
  indexKey,
  programDigest,
  selectPrograms,
} from "./fs-query-index/run.mjs";

const readJson = (path) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));
const text = (value) => JSON.stringify(value);

/**
 * The coverage table: every valid combination of the PICT model of the coverage ledger
 * (Config, Scope, Filter, Form, Name; order 5), in the corpus order.
 */
const TABLE = `
imb coll aB plan asc
imb coll aBContains plan none
imb coll aContains plan asc
imb coll aContainsAny plain asc
imb coll aContainsAny plain desc
imb coll aShared plain asc
imb coll aShared plain desc
imb coll aShared plan asc
imb coll aShared plan desc
imb coll shared plain asc
imb coll shared plain desc
ima coll aEq count desc
ima coll aEq count none
ima coll aEq in1 desc
ima coll aEq or2 desc
ima coll aEq orderEq desc
ima coll aEq orderEqName desc
ima coll aNull plain desc
ima coll none plain desc
imx coll aBContains count desc
imx coll aBContains count none
imx coll aBContains plain desc
imx coll aBContains plan desc
imx coll aBContainsAny plain desc
imx coll aBContainsAny plain none
imx coll containsAlone plain none
imx coll none plain desc
imx group aBContains plain none
imx group aBContainsAny plain none
imx group aContains plain none
imc coll aBContains plain desc
imc coll aBContains plan none
imc group aBContains plain none
imc group aContains plain none
igc coll none plain asc
igc coll none plain desc
igc group aEq plain asc
igc group aEq plain desc
igc group aEq plan desc
igc group none plain asc
igc group none plain desc
iga coll none plain asc
iga coll none plain desc
iga group aContains plain asc
iga group aContains plain desc
iga group aContains plan desc
iga group aEq plain asc
iga group aEq plain desc
iga group aEq plan asc
iga group containsAlone plain asc
iga group containsAlone plain desc
iga group none plain asc
iga group none plain desc
`
  .trim()
  .split("\n")
  .map((line) => line.split(" "));

/** The must-have shapes (docs.local coverage ledger seed file), each a row of the table. */
const MUST_HAVE = [
  "igc group aEq plain desc",
  "iga group aContains plain desc",
  "iga group aEq plain asc",
  "ima coll aEq orderEq desc",
  "ima coll aEq orderEqName desc",
  "ima coll aEq in1 desc",
  "ima coll aEq or2 desc",
  "ima coll aNull plain desc",
  "ima coll aEq count desc",
  "imx coll aBContains plain desc",
  "imx coll aBContainsAny plain none",
  "imx coll aBContains count none",
  "imb coll aContainsAny plain desc",
  "imb coll shared plain asc",
  "imb coll shared plain desc",
  "imb coll aShared plain asc",
  "imb coll aShared plain desc",
  "imb coll aContains plan asc",
  "imb coll aBContains plan none",
  "imb coll aB plan asc",
  "imc coll aBContains plan none",
  "imx group aContains plain none",
  "imc group aContains plain none",
  "ima coll none plain desc",
  "imx coll none plain desc",
  "imx coll containsAlone plain none",
  "igc coll none plain asc",
  "iga group none plain asc",
];

/** The three overrides this lane's file adds to the merge lane's file, exactly. */
const ADDED_OVERRIDES = [
  {
    collectionGroup: "igc",
    fieldPath: "a",
    indexes: [{ queryScope: "COLLECTION_GROUP", order: "ASCENDING" }],
  },
  {
    collectionGroup: "iga",
    fieldPath: "a",
    indexes: [{ queryScope: "COLLECTION_GROUP", order: "DESCENDING" }],
  },
  {
    collectionGroup: "iga",
    fieldPath: "tags",
    indexes: [{ queryScope: "COLLECTION_GROUP", arrayConfig: "CONTAINS" }],
  },
];

const GROUP_OF = { imb: "imb", ima: "ima", imx: "imx", imc: "imc", igc: "igc", iga: "iga" };
const PROGRAM_OF = {
  imb: "builtin",
  ima: "ascending-only",
  imx: "exempt-with-composite",
  imc: "composite-not-exempt",
  igc: "group-ascending",
  iga: "group-descending-contains",
};

// The query each axis value describes, written out in REST JSON (independent of values.mjs).
const int = (n) => ({ integerValue: String(n) });
const eq = (path, value) => ({
  fieldFilter: { field: { fieldPath: path }, op: "EQUAL", value },
});
const A = eq("a", int(1));
const B = eq("b", int(1));
const CONTAINS = {
  fieldFilter: { field: { fieldPath: "tags" }, op: "ARRAY_CONTAINS", value: int(1) },
};
const CONTAINS_ANY = {
  fieldFilter: {
    field: { fieldPath: "tags" },
    op: "ARRAY_CONTAINS_ANY",
    value: { arrayValue: { values: [int(1)] } },
  },
};
const TAGS_EQ = eq("tags", { arrayValue: { values: [int(1), int(2)] } });
const all = (...filters) => ({ compositeFilter: { op: "AND", filters } });
const WHERE = {
  aEq: A,
  aNull: { unaryFilter: { field: { fieldPath: "a" }, op: "IS_NULL" } },
  aB: all(A, B),
  aContains: all(A, CONTAINS),
  aContainsAny: all(A, CONTAINS_ANY),
  aBContains: all(A, B, CONTAINS),
  aBContainsAny: all(A, B, CONTAINS_ANY),
  containsAlone: CONTAINS,
  shared: all(TAGS_EQ, CONTAINS),
  aShared: all(A, TAGS_EQ, CONTAINS),
  none: undefined,
};
const order = (path, name) => ({
  field: { fieldPath: path },
  direction: name === "asc" ? "ASCENDING" : "DESCENDING",
});

function expectedStep(config, scope, filter, form, name) {
  const from = [
    { collectionId: GROUP_OF[config], ...(scope === "group" ? { allDescendants: true } : {}) },
  ];
  let where = WHERE[filter];
  if (form === "in1")
    where = {
      fieldFilter: {
        field: { fieldPath: "a" },
        op: "IN",
        value: { arrayValue: { values: [int(1)] } },
      },
    };
  if (form === "or2") where = { compositeFilter: { op: "OR", filters: [A, eq("a", int(0))] } };
  let orderBy;
  if (filter === "none") orderBy = [order("a", name)];
  else if (form === "orderEq") orderBy = [order("a", name)];
  else if (form === "orderEqName") orderBy = [order("a", "asc"), order("__name__", name)];
  else if (name !== "none") orderBy = [order("__name__", name)];
  const structured = {
    from,
    ...(where ? { where } : {}),
    ...(orderBy ? { orderBy } : {}),
  };
  if (form === "count")
    return {
      rpc: "runAggregationQuery",
      body: {
        structuredAggregationQuery: {
          structuredQuery: structured,
          aggregations: [{ alias: "n", count: {} }],
        },
      },
    };
  return {
    rpc: "runQuery",
    body: {
      structuredQuery: { ...structured, select: { fields: [{ fieldPath: "c" }] } },
      ...(form === "plan" ? { explainOptions: {} } : {}),
    },
  };
}

const stepsOf = (programs) => programs.flatMap((p) => p.steps.map((s) => [p, s]));

test("the rows are the coverage table, and each step is the query its axes describe", () => {
  assert.deepEqual(ROWS, TABLE);
  assert.equal(ROWS.length, 53);
  for (const row of ROWS) {
    const [config] = row;
    const program = PROGRAMS.find((p) => p.id === `${LANE_PREFIX}shapes/${PROGRAM_OF[config]}`);
    assert.ok(program, config);
    const step = program.steps.find((s) => s.id === stepId(row));
    assert.ok(step, `${config}#${stepId(row)}`);
    assert.deepEqual({ rpc: step.rpc, body: step.body }, expectedStep(...row), row.join(" "));
    assert.equal(step.transport, undefined, "REST");
    assert.equal(step.parent, undefined, "the documents root");
  }
  // Every step is a row: nothing else is recorded.
  assert.equal(stepsOf(PROGRAMS).length, ROWS.length);
});

test("step ids name the row's axes and are unique in their program", () => {
  const ids = (config) => ROWS.filter(([c]) => c === config).map(stepId);
  for (const config of Object.keys(PROGRAM_OF))
    assert.equal(new Set(ids(config)).size, ids(config).length, config);
  assert.deepEqual(ids("igc"), [
    "order-a-asc",
    "order-a-desc",
    "group-a-name-asc",
    "group-a-name-desc",
    "group-a-name-desc-plan",
    "group-order-a-asc",
    "group-order-a-desc",
  ]);
  assert.deepEqual(ids("ima"), [
    "count-a-name-desc",
    "count-a",
    "a-in-one-name-desc",
    "a-or-two-name-desc",
    "a-order-a-desc",
    "a-order-a-asc-name-desc",
    "a-is-null-name-desc",
    "order-a-desc",
  ]);
  assert.deepEqual(ids("imb").slice(0, 5), [
    "a-and-b-name-asc-plan",
    "a-b-and-contains-plan",
    "a-and-contains-name-asc-plan",
    "a-and-contains-any-name-asc",
    "a-and-contains-any-name-desc",
  ]);
});

test("the must-have shapes are rows", () => {
  const rows = new Set(ROWS.map((r) => r.join(" ")));
  for (const shape of MUST_HAVE) assert.ok(rows.has(shape), shape);
  assert.equal(MUST_HAVE.length, 28);
});

test("the second merge lane is its own entry and leaves the other lanes alone", () => {
  const lane = LANES[LANE_ID];
  assert.equal(LANE_ID, "fs-query-index-merge2");
  assert.equal(selectLane(LANE_ID), lane);
  assert.deepEqual(lane, {
    id: "fs-query-index-merge2",
    taskId: "FS-QUERY-INDEX-MERGE-2",
    corpus: "../fs-query-index-merge2/corpus.mjs",
    fixture: "fs-query-index-merge2-production.json",
    indexes: "fs-query-index-merge2.indexes.json",
    localConfig: "fs-query-index-merge2.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge2"],
  });
  // The first merge lane and the base lanes keep their files.
  assert.equal(LANES["fs-query-index-merge"].indexes, "fs-query-index-merge.indexes.json");
  assert.equal(LANES["fs-query-index-merge"].fixture, "fs-query-index-merge-production.json");
  for (const id of ["fs-query-index", "fs-data-write-list"])
    assert.equal(LANES[id].indexes, "fs-query-index.indexes.json", id);
  const others = Object.values(LANES).filter((l) => l !== lane);
  for (const key of ["fixture", "taskId", "corpus", "indexes", "localConfig"])
    assert.ok(!others.some((l) => l[key] === lane[key]), `${key} is the lane's own`);
});

test("programs validate only under the lane prefix and have their own digests", () => {
  assert.equal(validateCorpus(PROGRAMS, LANE_ID), 53);
  assert.throws(() => validateCorpus(PROGRAMS, "fs-query-index-merge"), /program id must be/);
  assert.deepEqual(selectPrograms(PROGRAMS, LANE_PREFIX), PROGRAMS);
  // The first merge lane's prefix selects none of these programs.
  assert.throws(() => selectPrograms(PROGRAMS, "fs-query-index-merge/"), /no program matches/);
  const digests = new Set([...PROGRAMS, ...MERGE_PROGRAMS].map(programDigest));
  assert.equal(digests.size, PROGRAMS.length + MERGE_PROGRAMS.length);
  assert.deepEqual(
    PROGRAMS.map((p) => [p.id, p.steps.length]),
    [
      ["fs-query-index-merge2/shapes/builtin", 11],
      ["fs-query-index-merge2/shapes/ascending-only", 8],
      ["fs-query-index-merge2/shapes/exempt-with-composite", 11],
      ["fs-query-index-merge2/shapes/composite-not-exempt", 4],
      ["fs-query-index-merge2/shapes/group-ascending", 7],
      ["fs-query-index-merge2/shapes/group-descending-contains", 12],
    ],
  );
});

test("the request bound and the cost estimate of two recordings", () => {
  // Per recording: 53 recorded steps, and 20 + 6 x (8 + 2) = 80 harness requests at most.
  assert.deepEqual(ceilings(PROGRAMS), { maxRequests: 53, maxHarnessRequests: 80 });
  assert.equal(estimatedUsd(PROGRAMS, 2), 0.0033);
});

test("each program seeds and reads only its own group", () => {
  assert.deepEqual(Object.keys(CONFIGS), Object.keys(PROGRAM_OF));
  for (const [config, name] of Object.entries(PROGRAM_OF)) {
    const program = PROGRAMS.find((p) => p.id === `${LANE_PREFIX}shapes/${name}`);
    const group = GROUP_OF[config];
    assert.equal(CONFIGS[config], group);
    assert.deepEqual(program.seed, seedFor(group));
    for (const step of program.steps) {
      const sq = step.body.structuredQuery ?? step.body.structuredAggregationQuery.structuredQuery;
      assert.equal(sq.from.length, 1);
      assert.equal(sq.from[0].collectionId, group);
    }
  }
  // The new groups are named by no other corpus or index file.
  const otherText = text([QUERY_PROGRAMS, LIST_PROGRAMS, MERGE_PROGRAMS]);
  for (const group of ["igc", "iga"]) {
    assert.ok(!otherText.includes(`"${group}/`), `${group} is seeded elsewhere`);
    assert.ok(!otherText.includes(`"collectionId":"${group}"`), `${group} is queried elsewhere`);
    for (const file of [
      "fs-query-index.indexes.json",
      "firestore.indexes.json",
      "fs-query-index-merge.indexes.json",
    ]) {
      const other = readJson(file);
      const named = [...other.indexes, ...(other.fieldOverrides ?? [])].map(
        (i) => i.collectionGroup,
      );
      assert.ok(!named.includes(group), `${file} names ${group}`);
    }
  }
});

test("the index file is the merge lane file plus the group-scope overrides, exactly", () => {
  const merge = readJson("fs-query-index-merge.indexes.json");
  const lane = readJson("fs-query-index-merge2.indexes.json");
  assert.deepEqual(Object.keys(lane), Object.keys(merge));
  assert.deepEqual(lane.indexes, merge.indexes);
  assert.deepEqual(lane.fieldOverrides, [...merge.fieldOverrides, ...ADDED_OVERRIDES]);
  const key = (i) => indexKey(i.collectionGroup, i.queryScope, i.fields);
  const shared = readJson("firestore.indexes.json");
  for (const index of shared.indexes) assert.ok(lane.indexes.map(key).includes(key(index)));
});

test("the local configuration is the merge one with its own index file", () => {
  const merge = readJson("fs-query-index-merge.fireemu.json");
  const config = readJson("fs-query-index-merge2.fireemu.json");
  assert.deepEqual(config, {
    ...merge,
    firestore: { ...merge.firestore, indexFile: "conformance/fs-query-index-merge2.indexes.json" },
  });
});

test("a production request addresses only the sandbox (default) database", () => {
  const ctx = createContext({
    run: "1",
    startedMs: Date.parse("2026-11-20T00:00:00Z"),
    target: { kind: "production", token: "ya29.secret", quotaProject: "fireemu-oracle-query" },
  });
  for (const [, step] of stepsOf(PROGRAMS)) {
    const { url, init } = buildRestRequest(step, ctx, new Map());
    assert.equal(
      url,
      `https://firestore.googleapis.com/v1/projects/fireemu-oracle-query/databases/(default)/documents:${step.rpc}`,
    );
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-goog-user-project"], "fireemu-oracle-query");
  }
});
