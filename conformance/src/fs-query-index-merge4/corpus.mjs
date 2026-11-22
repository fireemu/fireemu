// Observation 2b-2 covers ASC and DESC carriers together (iwd) and a carrier with tags in ordered modes only (io1).
// The rows are the coverage ledger's table for Config, Filter, Form and Name.

import { seedFor } from "../fs-query-index-merge/corpus.mjs";
import { and, asc, desc, f, field, from, int, query } from "../fs-query-index/values.mjs";

export const LANE_ID = "fs-query-index-merge4";
export const LANE_PREFIX = `${LANE_ID}/`;

/** The collection group of each configuration. */
export const CONFIGS = {
  iwd: "iwd",
  io1: "io1",
};

const PROGRAM_NAMES = {
  iwd: "asc-and-desc-carriers",
  io1: "carrier-tags-ordered-only",
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
const ORDER_FIELD = { orderA: "a", orderTags: "tags" };

/**
 * One row per step: [config, filter, form, name]. The name direction orders on `__name__` or on the field of an order-only row, and `none` sends no order.
 */
export const ROWS = `
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

/** The step id names the axes of a row and is unique in its program. */
export function stepId([, filter, form, name]) {
  if (ORDER_FIELD[filter]) return `order-${ORDER_FIELD[filter]}-${name}`;
  const base = SLUG[filter];
  const named = name === "none" ? base : `${base}-name-${name}`;
  if (form === "plan") return `${named}-plan`;
  return named;
}

export const TABLE_PROGRAMS = Object.entries(PROGRAM_NAMES).map(([config, name]) => ({
  id: `${LANE_PREFIX}shapes/${name}`,
  seed: seedFor(CONFIGS[config]),
  steps: ROWS.filter(([c]) => c === config).map((row) => {
    const [, filter, form, name] = row;
    const where = WHERE[filter];
    const path = ORDER_FIELD[filter] ?? "__name__";
    const direction = name === "asc" ? asc : desc;
    const structured = {
      from: from(CONFIGS[config]),
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
