// The index-merge observation (issue "index-merge-unrecorded-shapes"): three query shapes where
// the planner's merge rule and its single-index rule disagree, and no production verdict exists.
// The shapes come from the Lean model of the index-merge decision
// (verification/lean/index-merge/IndexMerge/Counterexamples.lean):
//
//   F1  a == x AND b == y AND tags array-contains z, with the composite (a ASC, tags CONTAINS)
//       and a, tags exempt from automatic indexes; b built-in
//   F2  a == x AND b == y ORDER BY __name__ DESC, with only a's ascending single-field index
//   F3  a == x AND tags array-contains z ORDER BY __name__ DESC, built-in indexes
//
// Each probe has controls that make its verdict readable: the other `__name__` direction, the
// same query where the missing mode is enabled or nothing is exempt, the sub-queries each merge
// member would serve alone, and readiness rows that show the field overrides are in effect.
//
// The lane is its own entry in lanes.mjs (corpus, fixture, ledger task), so nothing the
// FS-QUERY-INDEX or FS-DATA-WRITE-LIST lanes recorded changes meaning. Every program uses its
// own collection group, which no other corpus or index file names; the indexes are in
// conformance/fs-query-index-merge.indexes.json.

import { and, arr, asc, desc, f, field, from, int, query } from "../fs-query-index/values.mjs";

export const MERGE_LANE = "fs-query-index-merge";
export const MERGE_PREFIX = `${MERGE_LANE}/`;

/** The collection group of each index configuration. */
export const GROUPS = {
  builtin: "imb",
  ascOnly: "ima",
  exemptComposite: "imx",
  compositeOnly: "imc",
};

/**
 * Eight documents per group. a == 1 AND b == 1 holds for x3 and x7, a == 1 AND tags contains 1
 * for x1, x3 and x7 (x5 lacks 1 in tags), so every merge answer has more than one row and a
 * `__name__` direction is visible.
 */
export const seedFor = (group) =>
  Array.from({ length: 8 }, (_, i) => [
    `${group}/x${i}`,
    {
      a: int(i % 2),
      b: int(Math.floor(i / 2) % 2),
      tags: i === 5 ? arr(int(2)) : arr(int(i % 2), int(2)),
      c: int(i),
    },
  ]);

const PLAN = { explainOptions: {} };
const A = f("a", "EQUAL", int(1));
const B = f("b", "EQUAL", int(1));
const TAGS = f("tags", "ARRAY_CONTAINS", int(1));

/** The where clause and order of each query kind; `name` is the `__name__` direction. */
const QUERIES = {
  F1: { where: and(A, B, TAGS) },
  F2: { where: and(A, B) },
  F3: { where: and(A, TAGS) },
  aAlone: { where: A },
  bAlone: { where: B },
  containsAlone: { where: TAGS },
  aContains: { where: and(A, TAGS) },
  aB: { where: and(A, B) },
  orderA: {},
};

/**
 * One row per step: [step id, configuration, query, direction, role]. The direction is the
 * `__name__` order, except for `orderA`, where it is the order on `a`; `none` sends no order.
 * Roles: the probe of a shape, a control expected to be served, a sub-query one merge member
 * would serve alone, and a readiness row whose answer shows a field override is in effect.
 */
export const ROWS = [
  ["f3-contains-name-desc", "builtin", "F3", "desc", "probe"],
  ["f3-contains-name-asc", "builtin", "F3", "asc", "control"],
  ["contains-alone-name-desc", "builtin", "containsAlone", "desc", "sub"],
  ["a-alone-name-desc", "builtin", "aAlone", "desc", "sub"],
  ["f2-equalities-name-desc", "builtin", "F2", "desc", "control"],
  ["f1-equalities-and-contains", "builtin", "F1", "none", "control"],
  ["f2-equalities-name-desc", "ascOnly", "F2", "desc", "probe"],
  ["f2-equalities-name-asc", "ascOnly", "F2", "asc", "control"],
  ["a-alone-name-desc", "ascOnly", "aAlone", "desc", "sub"],
  ["a-alone-name-asc", "ascOnly", "aAlone", "asc", "sub"],
  ["b-alone-name-desc", "ascOnly", "bAlone", "desc", "sub"],
  ["order-a-desc", "ascOnly", "orderA", "desc", "readiness"],
  ["order-a-asc", "ascOnly", "orderA", "asc", "control"],
  ["f1-equalities-and-contains", "exemptComposite", "F1", "none", "probe"],
  ["a-and-contains", "exemptComposite", "aContains", "none", "sub"],
  ["b-alone", "exemptComposite", "bAlone", "none", "sub"],
  ["a-and-b", "exemptComposite", "aB", "none", "sub"],
  ["order-a-desc", "exemptComposite", "orderA", "desc", "readiness"],
  ["contains-alone", "exemptComposite", "containsAlone", "none", "readiness"],
  ["f1-equalities-and-contains", "compositeOnly", "F1", "none", "control"],
  ["a-and-contains", "compositeOnly", "aContains", "none", "control"],
];

function structured(group, kind, direction) {
  const order = (path) =>
    direction === "none" ? {} : { orderBy: [(direction === "asc" ? asc : desc)(path)] };
  return {
    from: from(group),
    ...QUERIES[kind],
    ...order(kind === "orderA" ? "a" : "__name__"),
    select: { fields: [field("c")] },
  };
}

const programOf = (config, id) => {
  const group = GROUPS[config];
  const rows = ROWS.filter(([, rowConfig]) => rowConfig === config);
  const steps = rows.map(([stepId, , kind, direction]) =>
    query(stepId, structured(group, kind, direction)),
  );
  // A plan-only Explain of the probe names the members production merges, or refuses.
  for (const [stepId, , kind, direction, role] of rows)
    if (role === "probe")
      steps.push(query(`${stepId}-plan`, structured(group, kind, direction), { body: PLAN }));
  return { id: `${MERGE_PREFIX}shapes/${id}`, seed: seedFor(group), steps };
};

export const PROGRAMS = [
  programOf("builtin", "builtin"),
  programOf("ascOnly", "ascending-only"),
  programOf("exemptComposite", "exempt-with-composite"),
  programOf("compositeOnly", "composite-not-exempt"),
];
