// The second index-merge observation (2a): index-selection shapes next to the ones the first
// observation recorded (conformance/fs-query-index-merge-production.json), whose production
// answer nobody has recorded, and which the emulator's strict profile keeps at its earlier answer
// (crates/fireemu-core-firestore/src/index.rs, stage B of the first observation):
//
//   - collection-group scope for the merge of an array-contains member with a descending
//     `__name__` (shape (a)) and for the refusal of a single equality ordered against its only
//     enabled direction (shape (c)), and that refusal mirrored;
//   - the neighbours of (c) (an order on the equality field, a one-element IN, an OR of two
//     equalities, IS NULL, a count aggregation), of (b) (descending `__name__`, array-contains-any,
//     a count) and of (a) (array-contains-any);
//   - the shared path `tags == [1, 2] AND tags array-contains 1`, alone and with `a == 1`;
//   - plan-only Explain rows that show the members of ascending merges;
//   - a collection-scoped composite asked for by a collection-group query with an array-contains.
//
// The rows are the coverage ledger's PICT table (axes Config, Scope, Filter, Form, Name; every
// valid combination). Four configurations are the first observation's, on the same collection
// groups and with the same entries (fs-query-index-merge.indexes.json); two groups are new and
// carry collection-group overrides only (fs-query-index-merge2.indexes.json):
//
//   imb  built-in indexes
//   ima  `a` with only its COLLECTION ascending index
//   imx  composite (a ASC, tags CONTAINS), `a` and `tags` exempt
//   imc  the same composite, nothing exempt
//   igc  `a` with only its COLLECTION_GROUP ascending index
//   iga  `a` with only COLLECTION_GROUP descending, `tags` with only COLLECTION_GROUP contains
//
// The sandbox `(default)` database carries those entries only during a send of this lane: the
// send creates them, records, then removes them again (the first observation's configuration
// program, conformance/src/fs-query-index-merge/config.mjs, set `obs2a`).

import { seedFor } from "../fs-query-index-merge/corpus.mjs";
import {
  aggregate,
  and,
  arr,
  asc,
  count,
  desc,
  f,
  field,
  from,
  int,
  or,
  query,
  u,
} from "../fs-query-index/values.mjs";

export const LANE_ID = "fs-query-index-merge2";
export const LANE_PREFIX = `${LANE_ID}/`;

/** The collection group of each configuration. */
export const CONFIGS = {
  imb: "imb",
  ima: "ima",
  imx: "imx",
  imc: "imc",
  igc: "igc",
  iga: "iga",
};

const PROGRAM_NAMES = {
  imb: "builtin",
  ima: "ascending-only",
  imx: "exempt-with-composite",
  imc: "composite-not-exempt",
  igc: "group-ascending",
  iga: "group-descending-contains",
};

const A = f("a", "EQUAL", int(1));
const B = f("b", "EQUAL", int(1));
const CONTAINS = f("tags", "ARRAY_CONTAINS", int(1));
const CONTAINS_ANY = f("tags", "ARRAY_CONTAINS_ANY", arr(int(1)));
const TAGS_EQ = f("tags", "EQUAL", arr(int(1), int(2)));

/** The where clause of each Filter value; `none` orders on `a` only. */
const WHERE = {
  aEq: A,
  aNull: u("a", "IS_NULL"),
  aB: and(A, B),
  aContains: and(A, CONTAINS),
  aContainsAny: and(A, CONTAINS_ANY),
  aBContains: and(A, B, CONTAINS),
  aBContainsAny: and(A, B, CONTAINS_ANY),
  containsAlone: CONTAINS,
  shared: and(TAGS_EQ, CONTAINS),
  aShared: and(A, TAGS_EQ, CONTAINS),
  none: undefined,
};

const SLUG = {
  aEq: "a",
  aNull: "a-is-null",
  aB: "a-and-b",
  aContains: "a-and-contains",
  aContainsAny: "a-and-contains-any",
  aBContains: "a-b-and-contains",
  aBContainsAny: "a-b-and-contains-any",
  containsAlone: "contains",
  shared: "shared-path",
  aShared: "a-and-shared-path",
};

/**
 * One row per step: [config, scope, filter, form, name]. `name` is the `__name__` direction
 * (`none` sends no order), except where the row orders on `a` (filter `none`, form `orderEq`):
 * there it is the direction of that order. Forms: `plain`; `orderEq` (ORDER BY a); `orderEqName`
 * (ORDER BY a ASC, __name__); `in1` (a IN [1]); `or2` (a == 1 OR a == 0); `count` (a count
 * aggregation of the query); `plan` (a plan-only Explain of the query).
 */
export const ROWS = `
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

/** The step id of a row: its axes in words, unique within its program. */
export function stepId([, scope, filter, form, name]) {
  const group = scope === "group" ? "group-" : "";
  if (filter === "none") return `${group}order-a-${name}`;
  if (form === "orderEq") return `${group}a-order-a-${name}`;
  if (form === "orderEqName") return `${group}a-order-a-asc-name-${name}`;
  const base = { in1: "a-in-one", or2: "a-or-two" }[form] ?? SLUG[filter];
  const named = name === "none" ? base : `${base}-name-${name}`;
  if (form === "count") return `${group}count-${named}`;
  if (form === "plan") return `${group}${named}-plan`;
  return `${group}${named}`;
}

const direction = (name) => (name === "asc" ? asc : desc);

function stepOf(row) {
  const [config, scope, filter, form, name] = row;
  let where = WHERE[filter];
  if (form === "in1") where = f("a", "IN", arr(int(1)));
  if (form === "or2") where = or(A, f("a", "EQUAL", int(0)));
  let orderBy;
  if (filter === "none" || form === "orderEq") orderBy = [direction(name)("a")];
  else if (form === "orderEqName") orderBy = [asc("a"), direction(name)("__name__")];
  else if (name !== "none") orderBy = [direction(name)("__name__")];
  const structured = {
    from: from(CONFIGS[config], scope === "group"),
    ...(where ? { where } : {}),
    ...(orderBy ? { orderBy } : {}),
  };
  const id = stepId(row);
  if (form === "count") return aggregate(id, structured, [count("n")]);
  const projected = { ...structured, select: { fields: [field("c")] } };
  return form === "plan"
    ? query(id, projected, { body: { explainOptions: {} } })
    : query(id, projected);
}

export const PROGRAMS = Object.entries(PROGRAM_NAMES).map(([config, name]) => ({
  id: `${LANE_PREFIX}shapes/${name}`,
  seed: seedFor(CONFIGS[config]),
  steps: ROWS.filter(([c]) => c === config).map(stepOf),
}));
