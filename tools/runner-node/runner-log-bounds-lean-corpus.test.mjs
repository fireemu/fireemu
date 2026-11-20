import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boundLogMessage } from "./log-context.mjs";

test("log bounds agree with the Lean UTF-16 and prefix reference", () => {
  const corpus = readFileSync(new URL("./tests/fixtures/lean-runner-log-bounds.corpus", import.meta.url), "utf8");
  const [heading, ...rows] = corpus.trimEnd().split("\n");
  assert.equal(heading, "# shape|prefix|budget|limit|UTF-16 decimal units|UTF-8 hex");
  assert.equal(rows.length, 108);
  for (const row of rows) {
    const [,,, limit, units, expected] = row.split("|");
    const value = units === "-" ? "" : String.fromCharCode(...units.split(",").map(Number));
    const result = boundLogMessage(value, Number(limit));
    const actualBytes = Buffer.from(result, "utf8");
    assert.equal(actualBytes.toString("hex"), expected === "-" ? "" : expected, row);
    assert.ok(actualBytes.length <= Number(limit), row);
    assert.equal(result, actualBytes.toString("utf8"), row);
  }
});
