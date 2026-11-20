// The read-only query shapes of the Lean findings triage (coordinator ruling 1 of the second
// index-merge observation; "Class C shapes by sandbox area", Firestore query/index): REST runQuery
// requests that need no configuration, on two collection groups of their own with built-in
// indexes. The program is the configured lane's last, so it cannot disturb the others.
//
//   T2  a timestamp with second 60, on a leap-second date and on another date
//   T1  timestamps whose offset moves the instant across the year range 0001 to 9999
//   C3  ORDER BY __name__ DESC, __name__ ASC (which refusal production reports)
//   I4  tags == [1] AND tags array-contains 1 with the built-in indexes, both `__name__`
//       directions, on two documents whose arrays differ ([1] and [1, 2])
//
// The timestamp values are literal strings in the REST request body (the harness sends the
// structured query as JSON without parsing values), so production's own parser reads them.
// I1 (a group composite for a collection query) goes to observation 2b; I2 (composite
// creations) to the named-database config-lifecycle area.

import { and, arr, asc, desc, f, from, int, query, ts } from "../fs-query-index/values.mjs";

const tEquals = (id, value) => query(id, { from: from("irt"), where: f("t", "EQUAL", ts(value)) });
const SHARED = and(f("tags", "EQUAL", arr(int(1))), f("tags", "ARRAY_CONTAINS", int(1)));

export const READ_ONLY_PROGRAM = {
  id: "fs-query-index-merge2/read-only/triage-shapes",
  seed: [
    ["irt/x0", { t: ts("2026-01-01T00:00:00Z") }],
    ["irt/x1", { t: ts("2016-12-31T23:59:59Z") }],
    ["irb/x0", { tags: arr(int(1)) }],
    ["irb/x1", { tags: arr(int(1), int(2)) }],
  ],
  steps: [
    tEquals("t2-leap-second", "2016-12-31T23:59:60Z"),
    tEquals("t2-second-60", "2026-01-01T00:00:60Z"),
    tEquals("t1-year-9999-minus-offset", "9999-12-31T23:59:59-00:01"),
    tEquals("t1-year-0001-plus-offset", "0001-01-01T00:00:00+00:01"),
    tEquals("t1-year-0000-plus-offset", "0000-01-01T00:00:00+00:01"),
    query("c3-name-desc-name-asc", {
      from: from("irt"),
      orderBy: [desc("__name__"), asc("__name__")],
    }),
    query("i4-shared-path-name-asc", {
      from: from("irb"),
      where: SHARED,
      orderBy: [asc("__name__")],
    }),
    query("i4-shared-path-name-desc", {
      from: from("irb"),
      where: SHARED,
      orderBy: [desc("__name__")],
    }),
  ],
};
