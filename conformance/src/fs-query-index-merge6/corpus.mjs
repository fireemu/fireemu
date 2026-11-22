// Observation 2b-4 covers a group composite for a collection query (I1), its reverse, and a configured composite as a merge member.
// The rows are the coverage ledger's table for Config, Scope, Filter, Form and Name.

import { seedFor } from "../fs-query-index-merge/corpus.mjs";
import { and, asc, desc, f, field, from, int, query } from "../fs-query-index/values.mjs";

export const LANE_ID = "fs-query-index-merge6";
export const LANE_PREFIX = `${LANE_ID}/`;

/** The collection group of each configuration. */
export const CONFIGS = {
  ig1: "ig1",
  irv: "irv",
  icm: "icm",
};

const PROGRAM_NAMES = {
  ig1: "group-composite-collection-query",
  irv: "collection-composite-group-query",
  icm: "composite-member",
};

const A = f("a", "EQUAL", int(1));
const CONTAINS = f("tags", "ARRAY_CONTAINS", int(1));

const WHERE = {
  aEq: A,
  aContains: and(A, CONTAINS),
  containsAlone: CONTAINS,
};

const SLUG = {
  orderAName: "order-a-asc",
  aEq: "a",
  aContains: "a-and-contains",
  containsAlone: "contains",
};

/** One row per step: [config, scope, filter, form, name]. */
export const ROWS = `
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

/** The step id names the axes of a row and is unique in its program. */
export function stepId([, scope, filter, form, name]) {
  const base = `${scope === "group" ? "group-" : ""}${SLUG[filter]}-name-${name}`;
  return form === "plan" ? `${base}-plan` : base;
}

export const TABLE_PROGRAMS = Object.entries(PROGRAM_NAMES).map(([config, name]) => ({
  id: `${LANE_PREFIX}shapes/${name}`,
  seed: seedFor(CONFIGS[config]),
  steps: ROWS.filter(([c]) => c === config).map((row) => {
    const [, scope, filter, form, name] = row;
    const where = WHERE[filter];
    const direction = name === "asc" ? asc : desc;
    const structured = {
      from: from(CONFIGS[config], scope === "group"),
      ...(where ? { where } : {}),
      orderBy: [...(filter === "orderAName" ? [asc("a")] : []), direction("__name__")],
    };
    const id = stepId(row);
    const projected = { ...structured, select: { fields: [field("c")] } };
    return form === "plan"
      ? query(id, projected, { body: { explainOptions: {} } })
      : query(id, projected);
  }),
}));

export const PROGRAMS = TABLE_PROGRAMS;
