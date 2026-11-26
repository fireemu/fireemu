import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { exerciseNative } from "./record.mjs";
import { nativeBudget } from "./session.mjs";

test("the run receipt survives a failure before any listener, SDK or oracle control starts", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-receipt-"));
  try {
    const out = join(root, "out");
    const pass = "c1";
    const runId = "0123abcd0123abcd";
    const budget = nativeBudget(30, 4);
    const result = await exerciseNative({
      out,
      spool: join(root, "spool"),
      ports: { android: -1, ios: -1 },
      pass,
      runId,
      budget,
      control: { prepare: () => assert.fail("unarmed run sent work") },
    });
    assert.deepEqual(JSON.parse(readFileSync(join(out, "run.json"), "utf8")), {
      runId,
      pass,
      pid: process.pid,
    });
    assert.equal(result.nativeRequests, 0);
    assert.equal(result.sandboxAtBaseline, true);
    assert.equal(result.complete, false);
    assert.equal(result.leakScanClean, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
