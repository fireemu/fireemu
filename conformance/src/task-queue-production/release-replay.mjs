// The release rerun of the task queue comparisons (R38 of release-strict-regression.mjs).
//
//   node release-replay.mjs local --fireemu <installed fireemu> --export <new file>
//
// Serves the task queue program with the strict profile under `productionExact` on the binary under test (a real fireemu process on
// loopback, nothing else), compares what the fixture saw with the two committed production recordings, and writes the three
// comparison documents it produced, keyed by the path of the committed file each one is judged against, with the digest of the
// binary. The strict comparisons are computed at twice the committed tolerance (see release-judge.mjs). It reads no credential and
// sends nothing to production.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RECORDINGS, compareRuns, compareStrict } from "./compare-cli.mjs";
import { TOLERANCE } from "./compare.mjs";
import { localProjection } from "./local.mjs";
import { EXPORT_KIND, TOLERANCE_FACTOR } from "./release-judge.mjs";

/** The value after `name` in `argv`, or `undefined` when the flag is absent or has no value. */
export function optionValue(argv, name) {
  const at = argv.indexOf(name);
  const value = at < 0 ? undefined : argv[at + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/** Whether the command line is `local --fireemu <binary> --export <file>`. */
export function usageOk(argv) {
  return (
    argv[0] === "local" &&
    optionValue(argv, "--fireemu") !== undefined &&
    optionValue(argv, "--export") !== undefined
  );
}

/** The three comparison documents for a local projection, keyed by repository path. */
export function documentsFor(local, pass1, pass2) {
  const tolerance = {
    firstMs: TOLERANCE.firstMs * TOLERANCE_FACTOR,
    gapMs: TOLERANCE.gapMs * TOLERANCE_FACTOR,
  };
  return {
    "conformance/task-queue-production-run-comparison.json": compareRuns(pass1, pass2),
    "conformance/task-queue-production-strict-vs-pass-1.json": compareStrict(local, pass1, {
      tolerance,
    }),
    "conformance/task-queue-production-strict-vs-pass-2.json": compareStrict(local, pass2, {
      tolerance,
    }),
  };
}

/** Replays the program on `binary` and returns the export. */
export async function replay(binary) {
  const local = await localProjection({ binary, profile: "strict", alias: "strict" });
  const load = async (path) => JSON.parse(await readFile(path, "utf8"));
  const [pass1, pass2] = [await load(RECORDINGS["pass-1"]), await load(RECORDINGS["pass-2"])];
  return {
    kind: EXPORT_KIND,
    binarySha256: createHash("sha256")
      .update(await readFile(binary))
      .digest("hex"),
    documents: documentsFor(local, pass1, pass2),
  };
}

/**
 * What a failed replay prints: one line per failing document, then one per failing row with the measured values, so a timing
 * outside the tolerance on a loaded runner can be told from a changed answer without the export.
 * @param {Record<string, object>} documents
 * @returns {string[]}
 */
export function failureLines(documents) {
  const lines = [];
  for (const [path, document] of Object.entries(documents)) {
    const { structure, timing } = document.summary;
    if (!structure.MISMATCH && !structure.UNKNOWN && !timing.OUTSIDE) continue;
    lines.push(
      `${path}: the replay has a mismatch, an unknown row or a timing outside the tolerance`,
    );
    for (const row of document.rows ?? []) {
      if (["MISMATCH", "UNKNOWN"].includes(row.structure))
        lines.push(`  ${row.case}: structure ${row.structure}`);
      if (row.timing?.verdict === "OUTSIDE")
        lines.push(
          `  ${row.case}: timing OUTSIDE (${row.timing.why}: ${row.timing.a} ms against ${row.timing.b} ms; tolerance ${JSON.stringify(document.tolerance)})`,
        );
    }
  }
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (!usageOk(argv)) {
    console.error("usage: release-replay.mjs local --fireemu <fireemu> --export <new file>");
    process.exit(2);
  }
  const result = await replay(resolve(optionValue(argv, "--fireemu")));
  await writeFile(resolve(optionValue(argv, "--export")), JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
  });
  const failed = failureLines(result.documents);
  for (const line of failed) console.error(line);
  process.exit(failed.length === 0 ? 0 : 1);
}
