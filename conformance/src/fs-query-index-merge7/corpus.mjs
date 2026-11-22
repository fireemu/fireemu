// Observation 2b-5 covers a collection-group carrier with b group-scoped and a descending-prefix carrier.
// The rows are the coverage ledger's table for Config, Scope, Filter, Form and Name.

import { seedFor } from "../fs-query-index-merge/corpus.mjs";
import { and, asc, desc, f, field, from, int, query } from "../fs-query-index/values.mjs";

export const LANE_ID = "fs-query-index-merge7";
export const LANE_PREFIX = `${LANE_ID}/`;

/** The collection group of each configuration. */
export const CONFIGS = {
  igx: "igx",
  ip1: "ip1",
};

const PROGRAM_NAMES = {
  igx: "group-carrier",
  ip1: "descending-prefix-carrier",
};

const A = f("a", "EQUAL", int(1));
const B = f("b", "EQUAL", int(1));
const CONTAINS = f("tags", "ARRAY_CONTAINS", int(1));

const WHERE = {
  aBContains: and(A, B, CONTAINS),
  aContains: and(A, CONTAINS),
  containsAlone: CONTAINS,
};

const SLUG = {
  aBContains: "a-b-and-contains",
  aContains: "a-and-contains",
  containsAlone: "contains",
};
const ORDER_FIELD = { orderA: "a", orderB: "b" };

/**
 * One row per step: [config, scope, filter, form, name]. The name direction orders on `__name__` or on the field of an order-only row, and `none` sends no order.
 */
export const ROWS = `
igx group aBContains plain none
igx group aBContains plan none
igx group aBContains plain desc
igx coll aBContains plain none
igx group aContains plain none
igx group containsAlone plain none
igx group orderB plain asc
igx coll orderB plain asc
igx group orderA plain desc
ip1 coll aBContains plain none
ip1 coll aBContains plan none
ip1 coll aBContains plain desc
ip1 coll aBContains plan desc
ip1 coll aContains plain none
ip1 coll aContains plain desc
ip1 coll containsAlone plain none
ip1 coll orderA plain desc
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
