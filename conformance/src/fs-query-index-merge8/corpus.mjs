// Observation 2b-6 covers the shared path with restricted modes and collection-scope readiness of the group-carrier configuration.
// The rows are the coverage ledger's table for Config, Scope, Filter, Form and Name.

import { seedFor } from "../fs-query-index-merge/corpus.mjs";
import { and, arr, asc, desc, f, field, from, int, query } from "../fs-query-index/values.mjs";

export const LANE_ID = "fs-query-index-merge8";
export const LANE_PREFIX = `${LANE_ID}/`;

/** The collection group of each configuration. */
export const CONFIGS = {
  igy: "igy",
  is1: "is1",
  is2: "is2",
};

const PROGRAM_NAMES = {
  igy: "group-carrier-collection-readiness",
  is1: "shared-path-ascending-only",
  is2: "shared-path-descending-only",
};

const A = f("a", "EQUAL", int(1));
const B = f("b", "EQUAL", int(1));
const CONTAINS = f("tags", "ARRAY_CONTAINS", int(1));
const TAGS_EQ = f("tags", "EQUAL", arr(int(1), int(2)));

const WHERE = {
  aBContains: and(A, B, CONTAINS),
  aContains: and(A, CONTAINS),
  containsAlone: CONTAINS,
  shared: and(TAGS_EQ, CONTAINS),
  aShared: and(A, TAGS_EQ, CONTAINS),
};

const SLUG = {
  aBContains: "a-b-and-contains",
  aContains: "a-and-contains",
  containsAlone: "contains",
  shared: "shared-path",
  aShared: "a-and-shared-path",
};
const ORDER_FIELD = { orderA: "a", orderTags: "tags" };

/**
 * One row per step: [config, scope, filter, form, name]. The name direction orders on `__name__` or on the field of an order-only row, and `none` sends no order.
 */
export const ROWS = `
igy coll aBContains plain none
igy coll containsAlone plain none
igy coll orderA plain desc
igy group aContains plain none
is1 coll aShared plain asc
is1 coll aShared plain desc
is1 coll aShared plan asc
is1 coll aShared plan desc
is1 coll shared plain asc
is1 coll containsAlone plain none
is1 coll orderTags plain asc
is1 coll orderA plain asc
is1 coll orderA plain desc
is2 coll aShared plain asc
is2 coll aShared plain desc
is2 coll aShared plan asc
is2 coll aShared plan desc
is2 coll shared plain asc
is2 coll containsAlone plain none
is2 coll orderTags plain asc
is2 coll orderA plain asc
is2 coll orderA plain desc
`
  .trim()
  .split("\n")
  .map((line) => line.split(" "));

/** The step id names the axes of a row and is unique in its program. */
export function stepId([, scope, filter, form, name]) {
  const orderField = ORDER_FIELD[filter];
  const slug = orderField ? `order-${orderField}-${name}` : SLUG[filter];
  const base = `${scope === "group" ? "group-" : ""}${slug}`;
  const named = orderField || name === "none" ? base : `${base}-name-${name}`;
  return form === "plan" ? `${named}-plan` : named;
}

export const TABLE_PROGRAMS = Object.entries(PROGRAM_NAMES).map(([config, name]) => ({
  id: `${LANE_PREFIX}shapes/${name}`,
  seed: seedFor(CONFIGS[config]),
  steps: ROWS.filter(([c]) => c === config).map((row) => {
    const [, scope, filter, form, name] = row;
    const where = WHERE[filter];
    const path = ORDER_FIELD[filter] ?? "__name__";
    const direction = name === "asc" ? asc : desc;
    const structured = {
      from: from(CONFIGS[config], scope === "group"),
      ...(where ? { where } : {}),
      ...(name === "none" ? {} : { orderBy: [direction(path)] }),
    };
    const id = stepId(row);
    const projected = { ...structured, select: { fields: [field("c")] } };
    return form === "plan"
      ? query(id, projected, { body: { explainOptions: {} } })
      : query(id, projected);
  }),
}));

export const PROGRAMS = TABLE_PROGRAMS;
