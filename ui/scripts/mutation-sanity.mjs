import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessSanity } from "./mutation-sanity-result.mjs";

// Use targeted-mutation with a bounded, known behavior-changing selection.
const uiRoot = fileURLToPath(new URL("../", import.meta.url));
process.chdir(uiRoot);
const source = readFileSync("src/lib/unsaved.tsx", "utf8");
const anchor = "if (guard) guard.request(() => next(index + 1));";
const lines = source.split("\n");
const matches = lines.flatMap((line, index) => (line.trim() === anchor ? [index] : []));
if (matches.length !== 1) {
  throw new Error("Scope-transition sanity anchor changed; review the mutant selection.");
}
const line = matches[0] + 1;
const tmtBin = fileURLToPath(
  new URL("../node_modules/targeted-mutation/bin/tmt.mjs", import.meta.url),
);
const run = spawnSync(
  process.execPath,
  [
    tmtBin,
    "analyze",
    ".",
    "--lines",
    `src/lib/unsaved.tsx:${line}`,
    "--test",
    "src/lib/unsaved.test.tsx",
    "--copy-exclude",
    "dist",
    "--copy-exclude",
    "test-results",
    "--copy-exclude",
    "e2e",
    "--format",
    "json",
  ],
  {
    cwd: uiRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);
if (run.error) {
  throw run.error;
}
if (run.stderr) {
  process.stderr.write(run.stderr);
}
if (run.status !== 0) {
  console.error(`targeted-mutation exited with status ${run.status ?? "unknown"}.`);
  process.exitCode = 1;
} else {
  const report = JSON.parse(run.stdout);
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/mutation-sanity.json", `${JSON.stringify(report, null, 2)}\n`);
  const result = assessSanity(report);
  if (result.isErr()) {
    console.error(result.error);
    process.exitCode = 1;
  } else {
    console.log(`Mutation sanity passed: ${result.value} scope-transition mutants killed.`);
  }
}
