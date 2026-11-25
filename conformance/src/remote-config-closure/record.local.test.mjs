// The closure recorder against a real local fireemu (strict profile), through the committed local
// runner: every case of the corpus is sent in order and answered with the status the stage 2 head
// gives (local-answers.json). Runs when FIREEMU_TEST_BINARY names a fireemu binary.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runLocal } from "../remote-config-production/local.mjs";

const binary = process.env.FIREEMU_TEST_BINARY;
const expected = JSON.parse(readFileSync(new URL("./local-answers.json", import.meta.url), "utf8"));

test(
  "the closure corpus runs end to end against strict fireemu",
  { skip: !binary, timeout: 240_000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "rc-closure-local-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, "run");
    const code = await runLocal({
      binary,
      profile: "strict",
      corpus: "closure",
      out,
      "events-file": join(dir, "events.jsonl"),
    });
    const journal = readFileSync(join(out, "journal.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const answers = journal
      .filter((row) => row.phase === "response-persisted")
      .map((row) => [row.case, row.status]);
    assert.deepEqual(answers, expected);
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    assert.equal(code, 0);
    assert.equal(result.complete, true);
    // Every client version the pass created reached both generations once, in order.
    for (const generation of ["1", "2"]) {
      const g = result.summary.generations[generation];
      assert.deepEqual(
        g.clientSteps.slice(-8),
        ["p1", "p5", "p6a", "p6b", "p7", "k1", "c9"].slice(-8),
        generation,
      );
      assert.equal(g.duplicates.length, 0);
      // Only the pass's own versions reached the handlers: the setup's events were dropped, as
      // production's handlers were deployed after its baseline.
      assert.equal(g.unmatched, 0, generation);
      assert.equal(g.events, 7, generation);
      assert.equal(g.inPublicationOrder, true);
      assert.equal(g.serverDelivery, "none-within-window");
    }
  },
);
