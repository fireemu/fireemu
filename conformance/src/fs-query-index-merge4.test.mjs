// Observation 2b-2 has its own lane, coverage table and index file. Nothing here sends a request.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import {
  CONFIGS,
  LANE_ID,
  LANE_PREFIX,
  PROGRAMS,
  ROWS,
  TABLE_PROGRAMS,
  stepId,
} from "./fs-query-index-merge4/corpus.mjs";
import { buildRestRequest, createContext, validateCorpus } from "./fs-query-index/harness.mjs";
import { LANES, selectLane } from "./fs-query-index/lanes.mjs";
import { ceilings, estimatedUsd, programDigest, selectPrograms } from "./fs-query-index/run.mjs";

const readJson = (path) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));

/** The coverage table in corpus order. */
const TABLE = `
iwd aBContains plain none
iwd aBContains plan none
iwd aBContains plain desc
iwd aBContains plan desc
iwd aContains plain none
iwd aContains plain desc
iwd containsAlone plain none
iwd orderA plain desc
io1 aBContains plain none
io1 aBContains plan none
io1 aBContains plain desc
io1 aContains plain none
io1 containsAlone plain none
io1 orderTags plain asc
io1 orderA plain desc
`
  .trim()
  .split("\n")
  .map((line) => line.split(" "));

/** The required F1 rows and the readiness probes. */
const MUST_HAVE = [
  "iwd aBContains plain none",
  "iwd aBContains plan none",
  "iwd aBContains plain desc",
  "iwd aBContains plan desc",
  "io1 aBContains plain none",
  "io1 aBContains plan none",
  "iwd aContains plain none",
  "iwd aContains plain desc",
  "iwd containsAlone plain none",
  "iwd orderA plain desc",
  "io1 aContains plain none",
  "io1 containsAlone plain none",
  "io1 orderTags plain asc",
  "io1 orderA plain desc",
];

const PROGRAM_OF = {
  iwd: "asc-and-desc-carriers",
  io1: "carrier-tags-ordered-only",
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
  containsAlone: CONTAINS,
};

function expectedStep(group, shape, form, name) {
  const where = WHERE[shape];
  const path = { orderA: "a", orderTags: "tags" }[shape] ?? "__name__";
  const order = {
    field: { fieldPath: path },
    direction: name === "asc" ? "ASCENDING" : "DESCENDING",
  };
  const structured = {
    from: [{ collectionId: group }],
    ...(where ? { where } : {}),
    ...(name === "none" ? {} : { orderBy: [order] }),
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
  assert.deepEqual(ids("iwd"), [
    "a-b-and-contains",
    "a-b-and-contains-plan",
    "a-b-and-contains-name-desc",
    "a-b-and-contains-name-desc-plan",
    "a-and-contains",
    "a-and-contains-name-desc",
    "contains",
    "order-a-desc",
  ]);
  assert.deepEqual(ids("io1"), [
    "a-b-and-contains",
    "a-b-and-contains-plan",
    "a-b-and-contains-name-desc",
    "a-and-contains",
    "contains",
    "order-tags-asc",
    "order-a-desc",
  ]);
});

test("the must-have shapes are rows", () => {
  const rows = new Set(ROWS.map((r) => r.join(" ")));
  for (const shape of MUST_HAVE) assert.ok(rows.has(shape), shape);
});

test("the fourth merge lane is its own entry and leaves the earlier lanes alone", () => {
  assert.equal(LANE_ID, "fs-query-index-merge4");
  assert.equal(LANE_PREFIX, "fs-query-index-merge4/");
  const lane = LANES[LANE_ID];
  assert.equal(selectLane(LANE_ID), lane);
  assert.deepEqual(lane, {
    id: "fs-query-index-merge4",
    taskId: "FS-QUERY-INDEX-MERGE-4",
    corpus: "../fs-query-index-merge4/corpus.mjs",
    fixture: "fs-query-index-merge4-production.json",
    indexes: "fs-query-index-merge4.indexes.json",
    localConfig: "fs-query-index-merge4.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge4"],
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
      ["fs-query-index-merge4/shapes/asc-and-desc-carriers", 8],
      ["fs-query-index-merge4/shapes/carrier-tags-ordered-only", 7],
    ],
  );
});

test("the request bound and the cost estimate of two recordings", () => {
  // Per recording: 15 recorded steps and 20 + 2 x (8 + 2) harness requests at most.
  assert.deepEqual(ceilings(PROGRAMS), { maxRequests: 15, maxHarnessRequests: 40 });
  assert.equal(estimatedUsd(PROGRAMS, 2), 0.001);
});

test("each program seeds and reads only its own group", () => {
  assert.deepEqual(CONFIGS, { iwd: "iwd", io1: "io1" });
  for (const [group, name] of Object.entries(PROGRAM_OF)) {
    const program = TABLE_PROGRAMS.find((p) => p.id === `${LANE_PREFIX}shapes/${name}`);
    assert.deepEqual(program.seed, seedFor(group));
    for (const step of program.steps) {
      assert.deepEqual(step.body.structuredQuery.from, [{ collectionId: group }]);
    }
  }
  const otherText = JSON.stringify([
    QUERY_PROGRAMS,
    LIST_PROGRAMS,
    MERGE_PROGRAMS,
    MERGE2_PROGRAMS,
    MERGE3_PROGRAMS,
    PIPELINE_PROGRAMS,
    REGEX_PROGRAMS,
    TEXT_PROGRAMS,
  ]);
  for (const group of ["iwd", "io1"]) {
    assert.ok(!otherText.includes(`"${group}/`), `${group} is seeded elsewhere`);
    assert.ok(!otherText.includes(`"collectionId":"${group}"`), `${group} is queried elsewhere`);
    for (const file of [
      "fs-query-index.indexes.json",
      "fs-query-index-merge.indexes.json",
      "fs-query-index-merge2.indexes.json",
      "fs-query-index-merge3.indexes.json",
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

test("the index file is the base file plus E17 to E23, exactly", () => {
  const base = readJson("fs-query-index.indexes.json");
  const lane = readJson("fs-query-index-merge4.indexes.json");
  const a = { fieldPath: "a", order: "ASCENDING" };
  const aDesc = { fieldPath: "a", order: "DESCENDING" };
  const tags = { fieldPath: "tags", arrayConfig: "CONTAINS" };
  const indexes = [
    { collectionGroup: "iwd", queryScope: "COLLECTION", fields: [a, tags] },
    { collectionGroup: "iwd", queryScope: "COLLECTION", fields: [aDesc, tags] },
    { collectionGroup: "io1", queryScope: "COLLECTION", fields: [a, tags] },
  ];
  const overrides = [
    { collectionGroup: "iwd", fieldPath: "a", indexes: [] },
    { collectionGroup: "iwd", fieldPath: "tags", indexes: [] },
    { collectionGroup: "io1", fieldPath: "a", indexes: [] },
    {
      collectionGroup: "io1",
      fieldPath: "tags",
      indexes: [
        { queryScope: "COLLECTION", order: "ASCENDING" },
        { queryScope: "COLLECTION", order: "DESCENDING" },
      ],
    },
  ];
  assert.deepEqual(lane, {
    ...base,
    indexes: [...base.indexes, ...indexes],
    fieldOverrides: [...base.fieldOverrides, ...overrides],
  });
  assert.deepEqual(
    ["E17", "E18", "E21"].map((id) => {
      const { group, queryScope, fields } = ENTRIES[id];
      return { collectionGroup: group, queryScope, fields };
    }),
    indexes,
  );
  assert.deepEqual(
    ["E19", "E20", "E22", "E23"].map((id) => {
      const { group, field, indexes } = ENTRIES[id];
      return { collectionGroup: group, fieldPath: field, indexes };
    }),
    overrides,
  );
});

test("the local configuration is the merge3 one with its own index file", () => {
  const merge3 = readJson("fs-query-index-merge3.fireemu.json");
  const config = readJson("fs-query-index-merge4.fireemu.json");
  assert.deepEqual(config, {
    ...merge3,
    firestore: { ...merge3.firestore, indexFile: "conformance/fs-query-index-merge4.indexes.json" },
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
