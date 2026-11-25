// A fresh local run of the RC-CLOSURE-B program against fireemu (FIREEMU_TEST_BINARY), in both
// profiles, compared with both production passes: no MISMATCH and no UNKNOWN row. Needs
// Playwright's Chromium and a fireemu binary; skipped otherwise, as in the conformance CI job.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { FILES } from "./evidence.mjs";
import { compare } from "./judge.mjs";
import { runLocal } from "./local.mjs";
import { sanitise } from "./sanitise.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.FIREEMU_TEST_BINARY;
const skip = !existsSync(chromium.executablePath())
  ? "Playwright Chromium is not installed"
  : !binary || !existsSync(binary)
    ? "FIREEMU_TEST_BINARY is not a fireemu binary"
    : false;

for (const [profile, port] of [
  ["emulator", 47911],
  ["strict", 47912],
]) {
  test(
    `a local ${profile} run matches both production passes`,
    { timeout: 300_000, skip },
    async (t) => {
      const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-local-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const result = await runLocal({ binary, profile, out: join(dir, "run"), port });
      assert.equal(result.complete, true, JSON.stringify([result.stopped, result.open]));
      const local = sanitise(join(dir, "run"));
      for (const key of ["pass1", "pass2"]) {
        const pass = JSON.parse(readFileSync(join(ROOT, FILES[key]), "utf8"));
        const { counts, table } = compare(pass, local, { local: true });
        assert.equal(
          counts.MISMATCH + counts.UNKNOWN,
          0,
          JSON.stringify(table.filter((r) => r.verdict === "MISMATCH" || r.verdict === "UNKNOWN")),
        );
      }
    },
  );
}
