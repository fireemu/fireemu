// Coordinator ruling 5, item 2 and its addition ask how second-60 writes are stored.
// The timestamp literals travel as strings in the REST commit bodies.

import { f, from, query, ts } from "../fs-query-index/values.mjs";

export const READ_ONLY_PROGRAM = {
  id: "fs-query-index-merge5/read-only/second-60-writes",
  seed: [],
  steps: [
    {
      id: "p7-write-leap",
      rpc: "commit",
      body: {
        writes: [{ update: { name: "{docs}/ilw/x0", fields: { t: ts("2016-12-31T23:59:60Z") } } }],
      },
    },
    { id: "p7-read-back-leap", rpc: "get", parent: "ilw/x0" },
    query("p7-query-stored-leap", {
      from: from("ilw"),
      where: f("t", "EQUAL", ts("2017-01-01T00:00:00Z")),
    }),
    {
      id: "p7-write-second-60",
      rpc: "commit",
      body: {
        writes: [{ update: { name: "{docs}/ilw/x1", fields: { t: ts("2026-01-01T00:00:60Z") } } }],
      },
    },
    { id: "p7-read-back-second-60", rpc: "get", parent: "ilw/x1" },
    query("p7-query-stored-second-60", {
      from: from("ilw"),
      where: f("t", "EQUAL", ts("2026-01-01T00:01:00Z")),
    }),
  ],
};
