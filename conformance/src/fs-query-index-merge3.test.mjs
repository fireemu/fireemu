// Observation 2b-1 has its own lane, coverage table and index file. Nothing here sends a request.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROGRAMS as LIST_PROGRAMS } from "./fs-list/corpus.mjs";
import { PROGRAMS as QUERY_PROGRAMS } from "./fs-query-index/corpus.mjs";
import { ENTRIES } from "./fs-query-index-merge/config.mjs";
import { PROGRAMS as MERGE_PROGRAMS, seedFor } from "./fs-query-index-merge/corpus.mjs";
import { PROGRAMS as MERGE2_PROGRAMS } from "./fs-query-index-merge2/corpus.mjs";
import {
  CONFIGS,
  LANE_ID,
  LANE_PREFIX,
  PROGRAMS,
  ROWS,
  TABLE_PROGRAMS,
  stepId,
} from "./fs-query-index-merge3/corpus.mjs";
import { READ_ONLY_PROGRAM } from "./fs-query-index-merge3/read-only.mjs";
import { buildRestRequest, createContext, validateCorpus } from "./fs-query-index/harness.mjs";
import { LANES, selectLane } from "./fs-query-index/lanes.mjs";
import { ceilings, estimatedUsd, programDigest, selectPrograms } from "./fs-query-index/run.mjs";

const readJson = (path) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));

/** The coverage table in corpus order. */
const TABLE = `
iw2 aBContains plain none
iw2 aBContains plan none
iw2 aBContains plain desc
iw2 aBContains count none
iw2 aContains plain none
iw2 bContains plain none
iw2 containsAlone plain none
iw2 orderA plain desc
iw2 orderB plain asc
it1 aBContains plain none
it1 aBContains plan none
it1 aBContains plain desc
it1 aBContains count none
it1 aContains plain none
it1 containsAlone plain none
it1 orderA plain desc
imd aEq plain asc
imd aEq plain none
imd aEq plan asc
imd aEq plain desc
imd aB plain asc
imd aB plan asc
imd aB plain desc
imd orderA plain asc
imd orderA plain desc
`
  .trim()
  .split("\n")
  .map((line) => line.split(" "));

/** The F1 rows, the mirror rows and the readiness probes from the coverage ledger seed file. */
const MUST_HAVE = [
  "iw2 aBContains plain none",
  "iw2 aBContains plan none",
  "it1 aBContains plain none",
  "it1 aBContains plan none",
  "imd aEq plain asc",
  "imd aEq plan asc",
  "imd aB plain asc",
  "imd aB plan asc",
  "iw2 aContains plain none",
  "iw2 bContains plain none",
  "iw2 containsAlone plain none",
  "iw2 orderA plain desc",
  "iw2 orderB plain asc",
  "it1 aContains plain none",
  "it1 containsAlone plain none",
  "it1 orderA plain desc",
  "imd orderA plain asc",
  "imd orderA plain desc",
  "imd aEq plain desc",
];

const PROGRAM_OF = {
  iw2: "two-carriers",
  it1: "carrier-contains-automatic",
  imd: "descending-only",
};

// The query each axis value describes, written out in REST JSON independently of values.mjs.
const int = (n) => ({ integerValue: String(n) });
const filter = (path, op, value) => ({ fieldFilter: { field: { fieldPath: path }, op, value } });
const A = filter("a", "EQUAL", int(1));
const B = filter("b", "EQUAL", int(1));
const CONTAINS = filter("tags", "ARRAY_CONTAINS", int(1));
const all = (...filters) => ({ compositeFilter: { op: "AND", filters } });
const WHERE = {
  aBContains: all(A, B, CONTAINS),
  aContains: all(A, CONTAINS),
  bContains: all(B, CONTAINS),
  containsAlone: CONTAINS,
  aEq: A,
  aB: all(A, B),
};

function expectedStep(group, shape, form, name) {
  const where = WHERE[shape];
  const path = { orderA: "a", orderB: "b" }[shape] ?? "__name__";
  const order = {
    field: { fieldPath: path },
    direction: name === "asc" ? "ASCENDING" : "DESCENDING",
  };
  const structured = {
    from: [{ collectionId: group }],
    ...(where ? { where } : {}),
    ...(name === "none" ? {} : { orderBy: [order] }),
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

test("the rows are the coverage table, and each step is the query its axes describe", () => {
  assert.deepEqual(ROWS, TABLE);
  assert.equal(ROWS.length, 25);
  for (const [config, name] of Object.entries(PROGRAM_OF)) {
    const program = TABLE_PROGRAMS.find((p) => p.id === `${LANE_PREFIX}shapes/${name}`);
    assert.ok(program, config);
    assert.deepEqual(
      program.steps,
      TABLE.filter(([group]) => group === config).map((row) => ({
        id: stepId(row),
        ...expectedStep(...row),
      })),
    );
  }
  assert.deepEqual(PROGRAMS, [...TABLE_PROGRAMS, READ_ONLY_PROGRAM]);
});

test("step ids name the row's axes and are unique in their program", () => {
  const ids = (config) => ROWS.filter(([c]) => c === config).map(stepId);
  for (const program of PROGRAMS) {
    assert.equal(new Set(program.steps.map((s) => s.id)).size, program.steps.length, program.id);
  }
  assert.deepEqual(ids("iw2"), [
    "a-b-and-contains",
    "a-b-and-contains-plan",
    "a-b-and-contains-name-desc",
    "count-a-b-and-contains",
    "a-and-contains",
    "b-and-contains",
    "contains",
    "order-a-desc",
    "order-b-asc",
  ]);
  assert.deepEqual(ids("it1"), [
    "a-b-and-contains",
    "a-b-and-contains-plan",
    "a-b-and-contains-name-desc",
    "count-a-b-and-contains",
    "a-and-contains",
    "contains",
    "order-a-desc",
  ]);
  assert.deepEqual(ids("imd"), [
    "a-name-asc",
    "a",
    "a-name-asc-plan",
    "a-name-desc",
    "a-and-b-name-asc",
    "a-and-b-name-asc-plan",
    "a-and-b-name-desc",
    "order-a-asc",
    "order-a-desc",
  ]);
});

test("the must-have shapes are rows", () => {
  const rows = new Set(ROWS.map((r) => r.join(" ")));
  for (const shape of MUST_HAVE) assert.ok(rows.has(shape), shape);
});

test("the third merge lane is its own entry and leaves the earlier lanes alone", () => {
  assert.equal(LANE_ID, "fs-query-index-merge3");
  assert.equal(LANE_PREFIX, "fs-query-index-merge3/");
  const lane = LANES[LANE_ID];
  assert.equal(selectLane(LANE_ID), lane);
  assert.deepEqual(lane, {
    id: "fs-query-index-merge3",
    taskId: "FS-QUERY-INDEX-MERGE-3",
    corpus: "../fs-query-index-merge3/corpus.mjs",
    fixture: "fs-query-index-merge3-production.json",
    indexes: "fs-query-index-merge3.indexes.json",
    localConfig: "fs-query-index-merge3.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge3"],
  });
  assert.deepEqual(LANES["fs-query-index-merge2"], {
    id: "fs-query-index-merge2",
    taskId: "FS-QUERY-INDEX-MERGE-2",
    corpus: "../fs-query-index-merge2/corpus.mjs",
    fixture: "fs-query-index-merge2-production.json",
    indexes: "fs-query-index-merge2.indexes.json",
    localConfig: "fs-query-index-merge2.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge2"],
  });
  assert.equal(LANES["fs-query-index-merge"].indexes, "fs-query-index-merge.indexes.json");
  assert.equal(LANES["fs-query-index-merge"].fixture, "fs-query-index-merge-production.json");
  assert.equal(LANES["fs-query-index-merge"].localConfig, "fs-query-index-merge.fireemu.json");
  for (const id of ["fs-query-index", "fs-data-write-list"]) {
    assert.equal(LANES[id].indexes, "fs-query-index.indexes.json", id);
    assert.equal(LANES[id].localConfig, "fs-query-index.fireemu.json", id);
  }
  const saved = readJson("fs-query-index-merge2-production.json").programs;
  assert.deepEqual(
    Object.fromEntries(MERGE2_PROGRAMS.map((p) => [p.id, programDigest(p)])),
    Object.fromEntries(Object.entries(saved).map(([id, p]) => [id, p.corpusDigest])),
  );
  const others = Object.values(LANES).filter((l) => l !== lane);
  for (const key of ["fixture", "taskId", "corpus", "indexes", "localConfig"]) {
    assert.ok(!others.some((l) => l[key] === lane[key]), `${key} is the lane's own`);
  }
});

test("programs validate only under the lane prefix and have their own digests", () => {
  assert.equal(validateCorpus(PROGRAMS, LANE_ID), 33);
  assert.deepEqual(selectPrograms(PROGRAMS, LANE_PREFIX), PROGRAMS);
  for (const lane of ["fs-query-index", "fs-query-index-merge", "fs-query-index-merge2"]) {
    assert.throws(() => validateCorpus(PROGRAMS, lane), /program id must be/);
    assert.throws(() => selectPrograms(PROGRAMS, `${lane}/`), /no program matches/);
  }
  const earlier = [...QUERY_PROGRAMS, ...LIST_PROGRAMS, ...MERGE_PROGRAMS, ...MERGE2_PROGRAMS];
  const digests = new Set(earlier.map(programDigest));
  for (const program of PROGRAMS) {
    const digest = programDigest(program);
    assert.ok(!digests.has(digest), program.id);
    digests.add(digest);
  }
  assert.deepEqual(
    PROGRAMS.map((p) => [p.id, p.steps.length]),
    [
      ["fs-query-index-merge3/shapes/two-carriers", 9],
      ["fs-query-index-merge3/shapes/carrier-contains-automatic", 7],
      ["fs-query-index-merge3/shapes/descending-only", 9],
      ["fs-query-index-merge3/read-only/leap-second", 8],
    ],
  );
});

test("the request bound and the cost estimate of two recordings", () => {
  // Per recording: 33 recorded steps and 20 + 4 x (8 + 2) harness requests at most.
  assert.deepEqual(ceilings(PROGRAMS), { maxRequests: 33, maxHarnessRequests: 60 });
  assert.equal(estimatedUsd(PROGRAMS, 2), 0.0021);
});

test("each program seeds and reads only its own group", () => {
  assert.deepEqual(CONFIGS, { iw2: "iw2", it1: "it1", imd: "imd" });
  for (const [group, name] of Object.entries(PROGRAM_OF)) {
    const program = TABLE_PROGRAMS.find((p) => p.id === `${LANE_PREFIX}shapes/${name}`);
    assert.deepEqual(program.seed, seedFor(group));
    for (const step of program.steps) {
      const sq = step.body.structuredQuery ?? step.body.structuredAggregationQuery.structuredQuery;
      assert.deepEqual(sq.from, [{ collectionId: group }]);
    }
  }
  const otherText = JSON.stringify([
    QUERY_PROGRAMS,
    LIST_PROGRAMS,
    MERGE_PROGRAMS,
    MERGE2_PROGRAMS,
  ]);
  for (const group of ["iw2", "it1", "imd", "ilp"]) {
    assert.ok(!otherText.includes(`"${group}/`), `${group} is seeded elsewhere`);
    assert.ok(!otherText.includes(`"collectionId":"${group}"`), `${group} is queried elsewhere`);
    for (const file of [
      "fs-query-index.indexes.json",
      "fs-query-index-merge.indexes.json",
      "fs-query-index-merge2.indexes.json",
      "firestore.indexes.json",
      "firestore-production.indexes.json",
      "fs-ent-text.indexes.json",
      "text-search/firestore.indexes.json",
    ]) {
      const other = readJson(file);
      const entries = [...(other.indexes ?? []), ...(other.fieldOverrides ?? [])];
      assert.ok(!entries.some((e) => e.collectionGroup === group), `${file} names ${group}`);
    }
  }
});

test("the index file is the base file plus E9 to E16, exactly", () => {
  const base = readJson("fs-query-index.indexes.json");
  const lane = readJson("fs-query-index-merge3.indexes.json");
  const a = { fieldPath: "a", order: "ASCENDING" };
  const b = { fieldPath: "b", order: "ASCENDING" };
  const tags = { fieldPath: "tags", arrayConfig: "CONTAINS" };
  const indexes = [
    { collectionGroup: "iw2", queryScope: "COLLECTION", fields: [a, tags] },
    { collectionGroup: "iw2", queryScope: "COLLECTION", fields: [b, tags] },
    { collectionGroup: "it1", queryScope: "COLLECTION", fields: [a, tags] },
  ];
  const overrides = [
    { collectionGroup: "iw2", fieldPath: "a", indexes: [] },
    { collectionGroup: "iw2", fieldPath: "b", indexes: [] },
    { collectionGroup: "iw2", fieldPath: "tags", indexes: [] },
    { collectionGroup: "it1", fieldPath: "a", indexes: [] },
    {
      collectionGroup: "imd",
      fieldPath: "a",
      indexes: [{ queryScope: "COLLECTION", order: "DESCENDING" }],
    },
  ];
  assert.deepEqual(lane, {
    ...base,
    indexes: [...base.indexes, ...indexes],
    fieldOverrides: [...base.fieldOverrides, ...overrides],
  });
  assert.deepEqual(
    ["E9", "E10", "E14"].map((id) => {
      const { group, queryScope, fields } = ENTRIES[id];
      return { collectionGroup: group, queryScope, fields };
    }),
    indexes,
  );
  assert.deepEqual(
    ["E11", "E12", "E13", "E15", "E16"].map((id) => {
      const { group, field, indexes } = ENTRIES[id];
      return { collectionGroup: group, fieldPath: field, indexes };
    }),
    overrides,
  );
});

test("the local configuration is the merge2 one with its own index file", () => {
  const merge2 = readJson("fs-query-index-merge2.fireemu.json");
  const config = readJson("fs-query-index-merge3.fireemu.json");
  assert.deepEqual(config, {
    ...merge2,
    firestore: { ...merge2.firestore, indexFile: "conformance/fs-query-index-merge3.indexes.json" },
  });
});

const ctx = createContext({
  run: "1",
  startedMs: Date.parse("2026-11-23T00:00:00Z"),
  target: { kind: "production", token: "test-only", quotaProject: "fireemu-oracle-query" },
});

test("a production request addresses only the sandbox (default) database", () => {
  for (const step of PROGRAMS.flatMap((p) => p.steps)) {
    const { url, init } = buildRestRequest(step, ctx, new Map());
    assert.equal(
      url,
      `https://firestore.googleapis.com/v1/projects/fireemu-oracle-query/databases/(default)/documents:${step.rpc}`,
    );
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-goog-user-project"], "fireemu-oracle-query");
  }
});

const ts = (value) => ({ timestampValue: value });

test("the read-only program holds the eight P7 queries on ilp and the four seed instants", () => {
  assert.equal(PROGRAMS.at(-1), READ_ONLY_PROGRAM);
  assert.equal(READ_ONLY_PROGRAM.id, `${LANE_PREFIX}read-only/leap-second`);
  assert.deepEqual(READ_ONLY_PROGRAM.seed, [
    ["ilp/x0", { t: ts("2016-12-31T23:59:59Z") }],
    ["ilp/x1", { t: ts("2017-01-01T00:00:00Z") }],
    ["ilp/x2", { t: ts("2026-01-01T00:00:59Z") }],
    ["ilp/x3", { t: ts("2026-01-01T00:01:00Z") }],
  ]);
  const leap = "2016-12-31T23:59:60Z";
  const second60 = "2026-01-01T00:00:60Z";
  const expected = [
    ["p7-leap-eq", "EQUAL", leap],
    ["p7-leap-ge", "GREATER_THAN_OR_EQUAL", leap],
    ["p7-leap-le", "LESS_THAN_OR_EQUAL", leap],
    ["p7-leap-gt", "GREATER_THAN", leap],
    ["p7-leap-lt", "LESS_THAN", leap],
    ["p7-second-60-eq", "EQUAL", second60],
    ["p7-second-60-ge", "GREATER_THAN_OR_EQUAL", second60],
    ["p7-second-60-le", "LESS_THAN_OR_EQUAL", second60],
  ].map(([id, op, value]) => ({
    id,
    rpc: "runQuery",
    body: {
      structuredQuery: { from: [{ collectionId: "ilp" }], where: filter("t", op, ts(value)) },
    },
  }));
  assert.deepEqual(READ_ONLY_PROGRAM.steps, expected);
});

test("the timestamp strings reach production literally in the request body", () => {
  for (const [prefix, value] of [
    ["p7-leap-", "2016-12-31T23:59:60Z"],
    ["p7-second-60-", "2026-01-01T00:00:60Z"],
  ]) {
    const steps = READ_ONLY_PROGRAM.steps.filter((s) => s.id.startsWith(prefix));
    assert.ok(steps.length > 0, prefix);
    for (const step of steps) {
      const { init } = buildRestRequest(step, ctx, new Map());
      assert.ok(init.body.includes(`"timestampValue":"${value}"`), step.id);
      assert.equal(
        JSON.parse(init.body).structuredQuery.where.fieldFilter.value.timestampValue,
        value,
      );
    }
  }
});
