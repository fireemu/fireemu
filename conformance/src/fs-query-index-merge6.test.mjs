// Observation 2b-4 has its own lane, coverage table and index file. Nothing here sends a request.

import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROGRAMS as PIPELINE_PROGRAMS } from "./fs-ent-pipeline/corpus.mjs";
import { PROGRAMS as REGEX_PROGRAMS } from "./fs-ent-pipeline/regex-corpus.mjs";
import { PROGRAMS as TEXT_PROGRAMS } from "./fs-ent-pipeline/text-corpus.mjs";
import { PROGRAMS as LIST_PROGRAMS } from "./fs-list/corpus.mjs";
import { PROGRAMS as QUERY_PROGRAMS } from "./fs-query-index/corpus.mjs";
import { ENTRIES } from "./fs-query-index-merge/config.mjs";
import { PROGRAMS as MERGE_PROGRAMS, seedFor } from "./fs-query-index-merge/corpus.mjs";
import { PROGRAMS as MERGE2_PROGRAMS } from "./fs-query-index-merge2/corpus.mjs";
import { PROGRAMS as MERGE3_PROGRAMS } from "./fs-query-index-merge3/corpus.mjs";
import { PROGRAMS as MERGE4_PROGRAMS } from "./fs-query-index-merge4/corpus.mjs";
import { PROGRAMS as MERGE5_PROGRAMS } from "./fs-query-index-merge5/corpus.mjs";
import {
  CONFIGS,
  LANE_ID,
  LANE_PREFIX,
  PROGRAMS,
  ROWS,
  TABLE_PROGRAMS,
  stepId,
} from "./fs-query-index-merge6/corpus.mjs";
import {
  buildRestRequest,
  createContext,
  guardRestRequest,
  validateCorpus,
} from "./fs-query-index/harness.mjs";
import { LANES, selectLane } from "./fs-query-index/lanes.mjs";
import { ceilings, estimatedUsd, programDigest, selectPrograms } from "./fs-query-index/run.mjs";

const readJson = (path) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));

/** The coverage table in corpus order. */
const TABLE = `
ig1 coll orderAName plain desc
ig1 coll orderAName plan desc
ig1 group orderAName plain desc
ig1 coll aEq plain desc
ig1 group aEq plain desc
irv group orderAName plain desc
irv group orderAName plan desc
irv coll orderAName plain desc
irv group aEq plain desc
irv coll aEq plain desc
icm coll aContains plain desc
icm coll aContains plan desc
icm coll aContains plain asc
icm coll aEq plain desc
icm coll containsAlone plain desc
`
  .trim()
  .split("\n")
  .map((line) => line.split(" "));

/** The I1 rows, the reverse rows, the composite-member rows and the readiness probes. */
const MUST_HAVE = [
  "ig1 coll orderAName plain desc",
  "ig1 coll orderAName plan desc",
  "ig1 group orderAName plain desc",
  "ig1 coll aEq plain desc",
  "ig1 group aEq plain desc",
  "irv group orderAName plain desc",
  "irv group orderAName plan desc",
  "irv coll orderAName plain desc",
  "irv group aEq plain desc",
  "irv coll aEq plain desc",
  "icm coll aContains plain desc",
  "icm coll aContains plan desc",
  "icm coll aContains plain asc",
  "icm coll aEq plain desc",
  "icm coll containsAlone plain desc",
];

const PROGRAM_OF = {
  ig1: "group-composite-collection-query",
  irv: "collection-composite-group-query",
  icm: "composite-member",
};

// The query each axis value describes, written out in REST JSON independently of values.mjs.
const int = (n) => ({ integerValue: String(n) });
const filter = (path, op, value) => ({ fieldFilter: { field: { fieldPath: path }, op, value } });
const A = filter("a", "EQUAL", int(1));
const CONTAINS = filter("tags", "ARRAY_CONTAINS", int(1));
const all = (...filters) => ({ compositeFilter: { op: "AND", filters } });
const WHERE = {
  aEq: A,
  aContains: all(A, CONTAINS),
  containsAlone: CONTAINS,
};

function expectedStep(group, scope, shape, form, name) {
  const where = WHERE[shape];
  const orderBy = [
    { field: { fieldPath: "__name__" }, direction: name === "asc" ? "ASCENDING" : "DESCENDING" },
  ];
  if (shape === "orderAName")
    orderBy.unshift({ field: { fieldPath: "a" }, direction: "ASCENDING" });
  const structured = {
    from: [{ collectionId: group, ...(scope === "group" ? { allDescendants: true } : {}) }],
    ...(where ? { where } : {}),
    orderBy,
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
  assert.equal(ROWS.length, 15);
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
  assert.equal(PROGRAMS, TABLE_PROGRAMS);
});

test("step ids name the row's axes and are unique in their program", () => {
  const ids = (config) => ROWS.filter(([c]) => c === config).map(stepId);
  for (const program of PROGRAMS) {
    assert.equal(new Set(program.steps.map((s) => s.id)).size, program.steps.length, program.id);
  }
  assert.deepEqual(ids("ig1"), [
    "order-a-asc-name-desc",
    "order-a-asc-name-desc-plan",
    "group-order-a-asc-name-desc",
    "a-name-desc",
    "group-a-name-desc",
  ]);
  assert.deepEqual(ids("irv"), [
    "group-order-a-asc-name-desc",
    "group-order-a-asc-name-desc-plan",
    "order-a-asc-name-desc",
    "group-a-name-desc",
    "a-name-desc",
  ]);
  assert.deepEqual(ids("icm"), [
    "a-and-contains-name-desc",
    "a-and-contains-name-desc-plan",
    "a-and-contains-name-asc",
    "a-name-desc",
    "contains-name-desc",
  ]);
});

test("the must-have shapes are rows", () => {
  const rows = new Set(ROWS.map((r) => r.join(" ")));
  for (const shape of MUST_HAVE) assert.ok(rows.has(shape), shape);
});

test("the sixth merge lane is its own entry and leaves the earlier lanes alone", () => {
  assert.equal(LANE_ID, "fs-query-index-merge6");
  assert.equal(LANE_PREFIX, "fs-query-index-merge6/");
  const lane = LANES[LANE_ID];
  assert.equal(selectLane(LANE_ID), lane);
  assert.deepEqual(lane, {
    id: "fs-query-index-merge6",
    taskId: "FS-QUERY-INDEX-MERGE-6",
    corpus: "../fs-query-index-merge6/corpus.mjs",
    fixture: "fs-query-index-merge6-production.json",
    indexes: "fs-query-index-merge6.indexes.json",
    localConfig: "fs-query-index-merge6.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge6"],
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
  assert.deepEqual(LANES["fs-query-index-merge3"], {
    id: "fs-query-index-merge3",
    taskId: "FS-QUERY-INDEX-MERGE-3",
    corpus: "../fs-query-index-merge3/corpus.mjs",
    fixture: "fs-query-index-merge3-production.json",
    indexes: "fs-query-index-merge3.indexes.json",
    localConfig: "fs-query-index-merge3.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge3"],
  });
  assert.deepEqual(LANES["fs-query-index-merge4"], {
    id: "fs-query-index-merge4",
    taskId: "FS-QUERY-INDEX-MERGE-4",
    corpus: "../fs-query-index-merge4/corpus.mjs",
    fixture: "fs-query-index-merge4-production.json",
    indexes: "fs-query-index-merge4.indexes.json",
    localConfig: "fs-query-index-merge4.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge4"],
  });
  assert.deepEqual(LANES["fs-query-index-merge5"], {
    id: "fs-query-index-merge5",
    taskId: "FS-QUERY-INDEX-MERGE-5",
    corpus: "../fs-query-index-merge5/corpus.mjs",
    fixture: "fs-query-index-merge5-production.json",
    indexes: "fs-query-index-merge5.indexes.json",
    localConfig: "fs-query-index-merge5.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge5"],
  });
  assert.equal(LANES["fs-query-index-merge"].indexes, "fs-query-index-merge.indexes.json");
  assert.equal(LANES["fs-query-index-merge"].fixture, "fs-query-index-merge-production.json");
  assert.equal(LANES["fs-query-index-merge"].localConfig, "fs-query-index-merge.fireemu.json");
  for (const id of ["fs-query-index", "fs-data-write-list"]) {
    assert.equal(LANES[id].indexes, "fs-query-index.indexes.json", id);
    assert.equal(LANES[id].localConfig, "fs-query-index.fireemu.json", id);
  }
  for (const [id, programs] of [
    ["fs-query-index-merge2", MERGE2_PROGRAMS],
    ["fs-query-index-merge3", MERGE3_PROGRAMS],
    ["fs-query-index-merge4", MERGE4_PROGRAMS],
    ["fs-query-index-merge5", MERGE5_PROGRAMS],
  ]) {
    const saved = readJson(LANES[id].fixture).programs;
    assert.deepEqual(
      Object.fromEntries(programs.map((p) => [p.id, programDigest(p)])),
      Object.fromEntries(Object.entries(saved).map(([id, p]) => [id, p.corpusDigest])),
    );
  }
  const others = Object.values(LANES).filter((l) => l !== lane);
  for (const key of ["fixture", "taskId", "corpus", "indexes", "localConfig"]) {
    assert.ok(!others.some((l) => l[key] === lane[key]), `${key} is the lane's own`);
  }
});

test("programs validate only under the lane prefix and have their own digests", () => {
  assert.equal(validateCorpus(PROGRAMS, LANE_ID), 15);
  assert.deepEqual(selectPrograms(PROGRAMS, LANE_PREFIX), PROGRAMS);
  for (const lane of [
    "fs-query-index",
    "fs-query-index-merge",
    "fs-query-index-merge2",
    "fs-query-index-merge3",
    "fs-query-index-merge4",
    "fs-query-index-merge5",
  ]) {
    assert.throws(() => validateCorpus(PROGRAMS, lane), /program id must be/);
    assert.throws(() => selectPrograms(PROGRAMS, `${lane}/`), /no program matches/);
  }
  const earlier = [
    ...QUERY_PROGRAMS,
    ...LIST_PROGRAMS,
    ...MERGE_PROGRAMS,
    ...MERGE2_PROGRAMS,
    ...MERGE3_PROGRAMS,
    ...MERGE4_PROGRAMS,
    ...MERGE5_PROGRAMS,
  ];
  const digests = new Set(earlier.map(programDigest));
  for (const program of PROGRAMS) {
    const digest = programDigest(program);
    assert.ok(!digests.has(digest), program.id);
    digests.add(digest);
  }
  assert.deepEqual(
    PROGRAMS.map((p) => [p.id, p.steps.length]),
    [
      ["fs-query-index-merge6/shapes/group-composite-collection-query", 5],
      ["fs-query-index-merge6/shapes/collection-composite-group-query", 5],
      ["fs-query-index-merge6/shapes/composite-member", 5],
    ],
  );
});

test("the request bound and the cost estimate of two recordings", () => {
  // Per recording: 15 recorded steps and 20 + 3 x (8 + 2) harness requests at most.
  assert.deepEqual(ceilings(PROGRAMS), { maxRequests: 15, maxHarnessRequests: 50 });
  assert.equal(estimatedUsd(PROGRAMS, 2), 0.001);
});

test("each program seeds and reads only its own group", () => {
  assert.deepEqual(CONFIGS, { ig1: "ig1", irv: "irv", icm: "icm" });
  for (const [group, name] of Object.entries(PROGRAM_OF)) {
    const program = TABLE_PROGRAMS.find((p) => p.id === `${LANE_PREFIX}shapes/${name}`);
    assert.deepEqual(program.seed, seedFor(group));
    for (const step of program.steps) {
      assert.equal(step.body.structuredQuery.from[0].collectionId, group);
    }
  }
  const otherText = JSON.stringify([
    QUERY_PROGRAMS,
    LIST_PROGRAMS,
    MERGE_PROGRAMS,
    MERGE2_PROGRAMS,
    MERGE3_PROGRAMS,
    MERGE4_PROGRAMS,
    MERGE5_PROGRAMS,
    PIPELINE_PROGRAMS,
    REGEX_PROGRAMS,
    TEXT_PROGRAMS,
  ]);
  const conformance = fileURLToPath(new URL("../", import.meta.url));
  const options = { cwd: conformance, exclude: ["**/node_modules", ".runs"] };
  const indexFiles = globSync("**/*indexes.json", options).filter(
    (path) => path !== "fs-query-index-merge6.indexes.json",
  );
  const corpusFiles = globSync(["**/*corpus*.mjs", "**/*corpus*.json"], options).filter(
    (path) => path !== "src/fs-query-index-merge6/corpus.mjs" && !path.endsWith(".test.mjs"),
  );
  for (const group of Object.keys(PROGRAM_OF)) {
    assert.ok(!otherText.includes(`"${group}/`), `${group} is addressed elsewhere`);
    assert.ok(!otherText.includes(`/${group}/`), `${group} is addressed elsewhere`);
    assert.ok(!otherText.includes(`"collectionId":"${group}"`), `${group} is queried elsewhere`);
    for (const path of indexFiles) {
      const other = readJson(path);
      const entries = [...(other.indexes ?? []), ...(other.fieldOverrides ?? [])];
      assert.ok(!entries.some((e) => e.collectionGroup === group), `${path} names ${group}`);
    }
    for (const path of corpusFiles) {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      assert.ok(!new RegExp(`\\b${group}\\b`).test(source), `${path} names ${group}`);
    }
  }
});

test("the index file is the base file plus E31 to E36, exactly", () => {
  const base = readJson("fs-query-index.indexes.json");
  const lane = readJson("fs-query-index-merge6.indexes.json");
  const a = { fieldPath: "a", order: "ASCENDING" };
  const name = { fieldPath: "__name__", order: "DESCENDING" };
  const indexes = [
    { collectionGroup: "ig1", queryScope: "COLLECTION_GROUP", fields: [a, name] },
    { collectionGroup: "irv", queryScope: "COLLECTION", fields: [a, name] },
    { collectionGroup: "icm", queryScope: "COLLECTION", fields: [a, name] },
  ];
  const overrides = [
    { collectionGroup: "ig1", fieldPath: "a", indexes: [] },
    { collectionGroup: "irv", fieldPath: "a", indexes: [] },
    { collectionGroup: "icm", fieldPath: "a", indexes: [] },
  ];
  assert.deepEqual(lane, {
    ...base,
    indexes: [...base.indexes, ...indexes],
    fieldOverrides: [...base.fieldOverrides, ...overrides],
  });
  assert.deepEqual(
    ["E31", "E33", "E35"].map((id) => {
      const { group, queryScope, fields } = ENTRIES[id];
      return { collectionGroup: group, queryScope, fields };
    }),
    indexes,
  );
  assert.deepEqual(
    ["E32", "E34", "E36"].map((id) => {
      const { group, field, indexes } = ENTRIES[id];
      return { collectionGroup: group, fieldPath: field, indexes };
    }),
    overrides,
  );
});

test("the local configuration is the merge4 one with its own index file", () => {
  const merge4 = readJson("fs-query-index-merge4.fireemu.json");
  const config = readJson("fs-query-index-merge6.fireemu.json");
  assert.deepEqual(config, {
    ...merge4,
    firestore: { ...merge4.firestore, indexFile: "conformance/fs-query-index-merge6.indexes.json" },
  });
});

const ctx = createContext({
  run: "1",
  startedMs: Date.parse("2026-11-23T00:00:00Z"),
  target: { kind: "production", token: "test-only", quotaProject: "fireemu-oracle-query" },
});

test("a production request addresses only the sandbox (default) database", () => {
  for (const step of PROGRAMS.flatMap((p) => p.steps)) {
    const request = buildRestRequest(step, ctx, new Map());
    guardRestRequest(request, ctx);
    const { url, init } = request;
    assert.equal(
      url,
      `https://firestore.googleapis.com/v1/projects/fireemu-oracle-query/databases/(default)/documents:${step.rpc}`,
    );
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), step.body);
    assert.equal(init.headers["x-goog-user-project"], "fireemu-oracle-query");
  }
});
