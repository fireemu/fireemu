// The strict profile against the committed Batch 3 recordings: a real fireemu process (strict) serves
// the recorder's two local attempts (`fs-write-limits-run.mjs rehearse-set writelimits`, both
// children, the same corpus the production run sent), and every one of the 61 REST programs and 3
// Write-stream recipes must answer as production did, by status, code, message and body. Skipped
// without a binary (FIREEMU_BIN); the conformance workflow runs it with the release build.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

import { compareWriteLimits, readSupplements } from "./fs-write-limits-compare.mjs";
import {
  bracketGroupCorpora,
  prepareWriteLimitsCorpus,
  selectBracketRecipes,
} from "./fs-write-limits-run.mjs";

const run = promisify(execFile);
const binary = process.env.FIREEMU_BIN;
const conformance = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test(
  "strict fireemu answers all 64 recorded Batch 3 recipes as production did, in both local attempts",
  { skip: binary ? false : "FIREEMU_BIN is not set", timeout: 900_000 },
  async () => {
    const { stdout } = await run(
      resolve(binary),
      [
        "exec",
        "--config",
        "conformance/fs-data-write-sandbox.fireemu.json",
        "--project",
        "fireemu-oracle-sbx",
        "--only",
        "firestore",
        "--firestore-port",
        "0",
        "--http-port",
        "0",
        "--storage-port",
        "0",
        "--hub-port",
        "0",
        "--logging-port",
        "0",
        "--",
        process.execPath,
        "conformance/src/fs-write-limits-run.mjs",
        "rehearse-set",
        "writelimits",
      ],
      { cwd: resolve(conformance, ".."), maxBuffer: 64 * 1024 * 1024, timeout: 800_000 },
    );
    const summary = JSON.parse(stdout.trim().split("\n").at(-1));
    const runDir = resolve(summary.runDir);
    try {
      assert.deepEqual(summary.requests, [194, 194]);
      assert.ok(
        summary.journals.every(
          ({ status, failedDeletes }) => status === "complete" && failedDeletes === 0,
        ),
      );
      const { recordingCorpus } = selectBracketRecipes(
        await prepareWriteLimitsCorpus(),
        "writelimits",
      );
      const groups = bracketGroupCorpora(recordingCorpus, "writelimits");
      const supplements = await readSupplements();
      for (const attempt of ["0", "1"]) {
        const result = compareWriteLimits({
          rest: JSON.parse(await readFile(join(runDir, `rest-${attempt}.json`), "utf8")),
          stream: JSON.parse(await readFile(join(runDir, `stream-${attempt}.json`), "utf8")),
          supplements,
          groups,
        });
        assert.deepEqual(result.problems, [], `attempt ${attempt}`);
        assert.deepEqual(result.differences, [], `attempt ${attempt}`);
        assert.equal(result.compared, 64);
      }
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  },
);
