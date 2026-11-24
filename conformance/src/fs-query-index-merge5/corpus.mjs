// Observation 2b-3 covers group-scope tags CONTAINS and a two-field carrier prefix.
// The rows are the coverage ledger's table for Config, Filter, Form and Name.

import { seedFor } from "../fs-query-index-merge/corpus.mjs";
import { and, asc, desc, f, field, from, int, query } from "../fs-query-index/values.mjs";
import { READ_ONLY_PROGRAM } from "./read-only.mjs";

export const LANE_ID = "fs-query-index-merge5";
export const LANE_PREFIX = `${LANE_ID}/`;

/** The collection group of each configuration. */
export const CONFIGS = {
  ig2: "ig2",
  i2p: "i2p",
};

const PROGRAM_NAMES = {
  ig2: "group-contains-only",
  i2p: "two-field-prefix",
};

const A = f("a", "EQUAL", int(1));
const B = f("b", "EQUAL", int(1));
const C = f("c", "EQUAL", int(3));
const CONTAINS = f("tags", "ARRAY_CONTAINS", int(1));

const WHERE = {
  abcContains: and(A, B, C, CONTAINS),
  aBContains: and(A, B, CONTAINS),
  aContains: and(A, CONTAINS),
  containsAlone: CONTAINS,
  containsAloneGroup: CONTAINS,
};

const SLUG = {
  abcContains: "a-b-c-and-contains",
  aBContains: "a-b-and-contains",
  aContains: "a-and-contains",
  containsAlone: "contains",
  containsAloneGroup: "group-contains",
};
const ORDER_FIELD = { orderA: "a", orderB: "b" };

/**
 * One row per step: [config, filter, form, name]. The name direction orders on `__name__` or on the field of an order-only row, and `none` sends no order.
 */
export const ROWS = `
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
      from: from(CONFIGS[config], filter === "containsAloneGroup"),
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

export const PROGRAMS = [...TABLE_PROGRAMS, READ_ONLY_PROGRAM];
