import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { InvocationBudget, ProtocolError } from "./protocol.mjs";

test("invocation admission and release traces agree with Lean", () => {
  const corpus = readFileSync(new URL("./tests/fixtures/lean-runner-invocation-budget.corpus", import.meta.url), "utf8");
  const [heading, ...rows] = corpus.trimEnd().split("\n");
  assert.equal(heading, "# count|bytes|trace|operations|snapshots");
  assert.equal(rows.length, 28);
  for (const row of rows) {
    const [maxCount, maxBytes,, encoded, answers] = row.split("|");
    const budget = new InvocationBudget({ maxCount: Number(maxCount), maxBytes: Number(maxBytes) });
    const releases = new Map();
    const observed = encoded.split(";").map((command) => {
      const [op, label, id, bytes] = command.split(",");
      let result = "ok";
      if (op === "reserve") {
        try {
          releases.set(label, budget.reserve(id === "-" ? "" : id, Number(bytes)));
        } catch (error) {
          assert.ok(error instanceof ProtocolError, row);
          const match = /^invalid runner frame \((.*)\)$/u.exec(error.message);
          assert.ok(match, row);
          result = match[1];
        }
      } else {
        assert.equal(op, "release");
        releases.get(label)?.();
      }
      const { count, payloadBytes, failed } = budget.state;
      return [result, count, payloadBytes, failed].join(":");
    });
    assert.deepEqual(observed, answers.split(";"), row);
  }
});
