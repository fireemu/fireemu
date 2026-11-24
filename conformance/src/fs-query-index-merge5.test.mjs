// Observation 2b-3 has its own lane, coverage table and index file. Nothing here sends a request.

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
import { PROGRAMS as MERGE4_PROGRAMS } from "./fs-query-index-merge4/corpus.mjs";
import {
  CONFIGS,
  LANE_ID,
  LANE_PREFIX,
  PROGRAMS,
  ROWS,
  TABLE_PROGRAMS,
  stepId,
} from "./fs-query-index-merge5/corpus.mjs";
import { READ_ONLY_PROGRAM } from "./fs-query-index-merge5/read-only.mjs";
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
ig2 aBContains plain none
ig2 aBContains plan none
ig2 aBContains plain desc
ig2 aContains plain none
ig2 containsAlone plain none
ig2 containsAloneGroup plain none
ig2 orderA plain desc
i2p abcContains plain none
i2p abcContains plan none
i2p abcContains plain desc
i2p aBContains plain none
i2p containsAlone plain none
i2p orderA plain desc
i2p orderB plain asc
`
  .trim()
  .split("\n")
  .map((line) => line.split(" "));

/** The required F1 rows and the readiness probes. */
const MUST_HAVE = [
  "ig2 aBContains plain none",
  "ig2 aBContains plan none",
  "i2p abcContains plain none",
  "i2p abcContains plan none",
  "ig2 aContains plain none",
  "ig2 containsAlone plain none",
  "ig2 containsAloneGroup plain none",
  "ig2 orderA plain desc",
  "i2p aBContains plain none",
  "i2p containsAlone plain none",
  "i2p orderA plain desc",
  "i2p orderB plain asc",
];

const PROGRAM_OF = {
  ig2: "group-contains-only",
  i2p: "two-field-prefix",
};

// The query each axis value describes, written out in REST JSON independently of values.mjs.
const int = (n) => ({ integerValue: String(n) });
const filter = (path, op, value) => ({ fieldFilter: { field: { fieldPath: path }, op, value } });
const A = filter("a", "EQUAL", int(1));
const B = filter("b", "EQUAL", int(1));
const C = filter("c", "EQUAL", int(3));
const CONTAINS = filter("tags", "ARRAY_CONTAINS", int(1));
const all = (...filters) => ({ compositeFilter: { op: "AND", filters } });
const WHERE = {
  abcContains: all(A, B, C, CONTAINS),
  aBContains: all(A, B, CONTAINS),
  aContains: all(A, CONTAINS),
  containsAlone: CONTAINS,
  containsAloneGroup: CONTAINS,
};

function expectedStep(group, shape, form, name) {
  const where = WHERE[shape];
  const path = { orderA: "a", orderB: "b" }[shape] ?? "__name__";
  const order = {
    field: { fieldPath: path },
    direction: name === "asc" ? "ASCENDING" : "DESCENDING",
  };
  const structured = {
    from: [
      { collectionId: group, ...(shape === "containsAloneGroup" ? { allDescendants: true } : {}) },
    ],
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
  assert.equal(ROWS.length, 14);
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
  assert.deepEqual(ids("ig2"), [
    "a-b-and-contains",
    "a-b-and-contains-plan",
    "a-b-and-contains-name-desc",
    "a-and-contains",
    "contains",
    "group-contains",
    "order-a-desc",
  ]);
  assert.deepEqual(ids("i2p"), [
    "a-b-c-and-contains",
    "a-b-c-and-contains-plan",
    "a-b-c-and-contains-name-desc",
    "a-b-and-contains",
    "contains",
    "order-a-desc",
    "order-b-asc",
  ]);
});

test("the must-have shapes are rows", () => {
  const rows = new Set(ROWS.map((r) => r.join(" ")));
  for (const shape of MUST_HAVE) assert.ok(rows.has(shape), shape);
});

test("the fifth merge lane is its own entry and leaves the earlier lanes alone", () => {
  assert.equal(LANE_ID, "fs-query-index-merge5");
  assert.equal(LANE_PREFIX, "fs-query-index-merge5/");
  const lane = LANES[LANE_ID];
  assert.equal(selectLane(LANE_ID), lane);
  assert.deepEqual(lane, {
    id: "fs-query-index-merge5",
    taskId: "FS-QUERY-INDEX-MERGE-5",
    corpus: "../fs-query-index-merge5/corpus.mjs",
    fixture: "fs-query-index-merge5-production.json",
    indexes: "fs-query-index-merge5.indexes.json",
    localConfig: "fs-query-index-merge5.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge5"],
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
  assert.equal(validateCorpus(PROGRAMS, LANE_ID), 20);
  assert.deepEqual(selectPrograms(PROGRAMS, LANE_PREFIX), PROGRAMS);
  for (const lane of [
    "fs-query-index",
    "fs-query-index-merge",
    "fs-query-index-merge2",
    "fs-query-index-merge3",
    "fs-query-index-merge4",
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
      ["fs-query-index-merge5/shapes/group-contains-only", 7],
      ["fs-query-index-merge5/shapes/two-field-prefix", 7],
      ["fs-query-index-merge5/read-only/second-60-writes", 6],
    ],
  );
});

test("the request bound and the cost estimate of two recordings", () => {
  // The two seeded programs use 10 harness requests each, and the unseeded program uses 8.
  const bounds = ceilings(PROGRAMS);
  assert.deepEqual(bounds, { maxRequests: 20, maxHarnessRequests: 48 });
  assert.ok(bounds.maxHarnessRequests <= 20 + 3 * 10);
  assert.equal(estimatedUsd(PROGRAMS, 2), 0.0013);
});

test("each program seeds and reads only its own group", () => {
  assert.deepEqual(CONFIGS, { ig2: "ig2", i2p: "i2p" });
  for (const [group, name] of Object.entries(PROGRAM_OF)) {
    const program = TABLE_PROGRAMS.find((p) => p.id === `${LANE_PREFIX}shapes/${name}`);
    assert.deepEqual(program.seed, seedFor(group));
    for (const step of program.steps) {
      assert.deepEqual(step.body.structuredQuery.from, [
        { collectionId: group, ...(step.id === "group-contains" ? { allDescendants: true } : {}) },
      ]);
    }
  }
  const otherText = JSON.stringify([
    QUERY_PROGRAMS,
    LIST_PROGRAMS,
    MERGE_PROGRAMS,
    MERGE2_PROGRAMS,
    MERGE3_PROGRAMS,
    MERGE4_PROGRAMS,
    PIPELINE_PROGRAMS,
    REGEX_PROGRAMS,
    TEXT_PROGRAMS,
  ]);
  for (const group of ["ig2", "i2p", "ilw"]) {
    assert.ok(!otherText.includes(`"${group}/`), `${group} is addressed elsewhere`);
    assert.ok(!otherText.includes(`/${group}/`), `${group} is addressed elsewhere`);
    assert.ok(!otherText.includes(`"collectionId":"${group}"`), `${group} is queried elsewhere`);
    for (const file of [
      "fs-query-index.indexes.json",
      "fs-query-index-merge.indexes.json",
      "fs-query-index-merge2.indexes.json",
      "fs-query-index-merge3.indexes.json",
      "fs-query-index-merge4.indexes.json",
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

test("the index file is the base file plus E24 to E30, exactly", () => {
  const base = readJson("fs-query-index.indexes.json");
  const lane = readJson("fs-query-index-merge5.indexes.json");
  const a = { fieldPath: "a", order: "ASCENDING" };
  const b = { fieldPath: "b", order: "ASCENDING" };
  const tags = { fieldPath: "tags", arrayConfig: "CONTAINS" };
  const indexes = [
    { collectionGroup: "ig2", queryScope: "COLLECTION", fields: [a, tags] },
    { collectionGroup: "i2p", queryScope: "COLLECTION", fields: [a, b, tags] },
  ];
  const overrides = [
    { collectionGroup: "ig2", fieldPath: "a", indexes: [] },
    {
      collectionGroup: "ig2",
      fieldPath: "tags",
      indexes: [{ queryScope: "COLLECTION_GROUP", arrayConfig: "CONTAINS" }],
    },
    { collectionGroup: "i2p", fieldPath: "a", indexes: [] },
    { collectionGroup: "i2p", fieldPath: "b", indexes: [] },
    { collectionGroup: "i2p", fieldPath: "tags", indexes: [] },
  ];
  assert.deepEqual(lane, {
    ...base,
    indexes: [...base.indexes, ...indexes],
    fieldOverrides: [...base.fieldOverrides, ...overrides],
  });
  assert.deepEqual(
    ["E24", "E27"].map((id) => {
      const { group, queryScope, fields } = ENTRIES[id];
      return { collectionGroup: group, queryScope, fields };
    }),
    indexes,
  );
  assert.deepEqual(
    ["E25", "E26", "E28", "E29", "E30"].map((id) => {
      const { group, field, indexes } = ENTRIES[id];
      return { collectionGroup: group, fieldPath: field, indexes };
    }),
    overrides,
  );
});

test("the local configuration is the merge4 one with its own index file", () => {
  const merge4 = readJson("fs-query-index-merge4.fireemu.json");
  const config = readJson("fs-query-index-merge5.fireemu.json");
  assert.deepEqual(config, {
    ...merge4,
    firestore: { ...merge4.firestore, indexFile: "conformance/fs-query-index-merge5.indexes.json" },
  });
});

const ctx = createContext({
  run: "1",
  startedMs: Date.parse("2026-11-23T00:00:00Z"),
  target: { kind: "production", token: "test-only", quotaProject: "fireemu-oracle-query" },
});

const documents = "projects/fireemu-oracle-query/databases/(default)/documents";

test("a production request addresses only the sandbox (default) database", () => {
  for (const step of PROGRAMS.flatMap((p) => p.steps)) {
    const request = buildRestRequest(step, ctx, new Map());
    guardRestRequest(request, ctx);
    const { url, init } = request;
    const get = step.rpc === "get";
    const path = get ? `/${step.parent}` : `:${step.rpc}`;
    assert.equal(url, `https://firestore.googleapis.com/v1/${documents}${path}`);
    assert.equal(init.method, get ? "GET" : "POST");
    assert.equal(init.headers["x-goog-user-project"], "fireemu-oracle-query");
    if (get) assert.equal(init.body, undefined);
  }
});

const ts = (value) => ({ timestampValue: value });

test("the read-only program holds the six P7 steps on ilw with no seed", () => {
  assert.equal(PROGRAMS.at(-1), READ_ONLY_PROGRAM);
  assert.equal(READ_ONLY_PROGRAM.id, `${LANE_PREFIX}read-only/second-60-writes`);
  assert.deepEqual(READ_ONLY_PROGRAM.seed, []);
  const expected = [
    ["leap", "x0", "2016-12-31T23:59:60Z", "2017-01-01T00:00:00Z"],
    ["second-60", "x1", "2026-01-01T00:00:60Z", "2026-01-01T00:01:00Z"],
  ].flatMap(([probe, doc, literal, stored]) => [
    {
      id: `p7-write-${probe}`,
      rpc: "commit",
      body: {
        writes: [{ update: { name: `{docs}/ilw/${doc}`, fields: { t: ts(literal) } } }],
      },
    },
    { id: `p7-read-back-${probe}`, rpc: "get", parent: `ilw/${doc}` },
    {
      id: `p7-query-stored-${probe}`,
      rpc: "runQuery",
      body: {
        structuredQuery: {
          from: [{ collectionId: "ilw" }],
          where: filter("t", "EQUAL", ts(stored)),
        },
      },
    },
  ]);
  assert.deepEqual(READ_ONLY_PROGRAM.steps, expected);
});

test("the second-60 timestamps reach the production commit bodies literally", () => {
  for (const [id, doc, value] of [
    ["p7-write-leap", "x0", "2016-12-31T23:59:60Z"],
    ["p7-write-second-60", "x1", "2026-01-01T00:00:60Z"],
  ]) {
    const step = READ_ONLY_PROGRAM.steps.find((s) => s.id === id);
    assert.ok(step, id);
    const { init } = buildRestRequest(step, ctx, new Map());
    assert.ok(init.body.includes(`"timestampValue":"${value}"`), id);
    assert.deepEqual(JSON.parse(init.body), {
      writes: [{ update: { name: `${documents}/ilw/${doc}`, fields: { t: ts(value) } } }],
    });
  }
});
