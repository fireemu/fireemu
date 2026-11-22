// Observation 2b-1 covers two carriers (iw2), a carrier with the automatic contains index (it1), and the collection-scope mirror of shape (c) with descending-only a (imd).
// The rows are the coverage ledger's table for Config, Filter, Form and Name.

import { seedFor } from "../fs-query-index-merge/corpus.mjs";
import {
  aggregate,
  and,
  asc,
  count,
  desc,
  f,
  field,
  from,
  int,
  query,
} from "../fs-query-index/values.mjs";
import { READ_ONLY_PROGRAM } from "./read-only.mjs";

export const LANE_ID = "fs-query-index-merge3";
export const LANE_PREFIX = `${LANE_ID}/`;

/** The collection group of each configuration. */
export const CONFIGS = {
  iw2: "iw2",
  it1: "it1",
  imd: "imd",
};

const PROGRAM_NAMES = {
  iw2: "two-carriers",
  it1: "carrier-contains-automatic",
  imd: "descending-only",
};

const A = f("a", "EQUAL", int(1));
const B = f("b", "EQUAL", int(1));
const CONTAINS = f("tags", "ARRAY_CONTAINS", int(1));

const WHERE = {
  aBContains: and(A, B, CONTAINS),
  aContains: and(A, CONTAINS),
  bContains: and(B, CONTAINS),
  containsAlone: CONTAINS,
  aEq: A,
  aB: and(A, B),
};

const SLUG = {
  aBContains: "a-b-and-contains",
  aContains: "a-and-contains",
  bContains: "b-and-contains",
  containsAlone: "contains",
  aEq: "a",
  aB: "a-and-b",
};
const ORDER_FIELD = { orderA: "a", orderB: "b" };

/**
 * One row per step: [config, filter, form, name]. The name direction orders on `__name__` or on the field of an order-only row, and `none` sends no order.
 */
export const ROWS = `
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

/** The step id names the axes of a row and is unique in its program. */
export function stepId([, filter, form, name]) {
  if (ORDER_FIELD[filter]) return `order-${ORDER_FIELD[filter]}-${name}`;
  const base = SLUG[filter];
  const named = name === "none" ? base : `${base}-name-${name}`;
  if (form === "count") return `count-${named}`;
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
    if (form === "count") return aggregate(id, structured, [count("n")]);
    const projected = { ...structured, select: { fields: [field("c")] } };
    return form === "plan"
      ? query(id, projected, { body: { explainOptions: {} } })
      : query(id, projected);
  }),
}));

export const PROGRAMS = [...TABLE_PROGRAMS, READ_ONLY_PROGRAM];
