// Coordinator ruling 3, item 7 of the second observation asks which instant the second-60 literal denotes.
// The timestamp literal travels as a string in the REST request body.

import { f, from, query, ts } from "../fs-query-index/values.mjs";

const leap = "2016-12-31T23:59:60Z";
const second60 = "2026-01-01T00:00:60Z";

export const READ_ONLY_PROGRAM = {
  id: "fs-query-index-merge3/read-only/leap-second",
  seed: [
    ["ilp/x0", { t: ts("2016-12-31T23:59:59Z") }],
    ["ilp/x1", { t: ts("2017-01-01T00:00:00Z") }],
    ["ilp/x2", { t: ts("2026-01-01T00:00:59Z") }],
    ["ilp/x3", { t: ts("2026-01-01T00:01:00Z") }],
  ],
  steps: [
    ["p7-leap-eq", "EQUAL", leap],
    ["p7-leap-ge", "GREATER_THAN_OR_EQUAL", leap],
    ["p7-leap-le", "LESS_THAN_OR_EQUAL", leap],
    ["p7-leap-gt", "GREATER_THAN", leap],
    ["p7-leap-lt", "LESS_THAN", leap],
    ["p7-second-60-eq", "EQUAL", second60],
    ["p7-second-60-ge", "GREATER_THAN_OR_EQUAL", second60],
    ["p7-second-60-le", "LESS_THAN_OR_EQUAL", second60],
  ].map(([id, op, value]) => query(id, { from: from("ilp"), where: f("t", op, ts(value)) })),
};
