// The committed RC-CLOSURE-B evidence: the two sanitised production passes of the Web client
// (send-web-1, send-web-2), a local strict and a local emulator run of the same program against
// fireemu (local.mjs), their five comparisons (judge.mjs), and the check that binds them.
//
//   node src/remote-config-web/evidence.mjs write --pass-1 <dir> --pass-2 <dir>
//     --local-strict <dir> --local-emulator <dir>
//       sanitises the four runs into conformance/remote-config-web/ (new files only), writes the
//       five comparisons, and prints the sha256 of each file for PINS
//   node src/remote-config-web/evidence.mjs check [--rev <git revision>] [--repo <dir>]
//       verifies the files of the revision (default HEAD), read as git blobs
//
// The directory must be exactly the pinned files, each with its pinned sha256; both pass fixtures
// are also pinned in the closure record lock; every fixture is a complete, sanitised pass; every
// comparison equals the one recomputed from the pinned fixtures; no comparison has a MISMATCH or
// UNKNOWN row; the known differences are exactly the pinned ids.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { gitReaders } from "../remote-config-production/evidence.mjs";
import { compare } from "./judge.mjs";
import { assertSanitised, sanitise, settlementProblems } from "./sanitise.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DIR = "conformance/remote-config-web";
export const KNOWN = "conformance/src/remote-config-web/known-differences.json";
export const RECORD_LOCK = "spec/compatibility/closure/record-digests.json";

export const FILES = {
  pass1: `${DIR}/closure-b-pass-1.json`,
  pass2: `${DIR}/closure-b-pass-2.json`,
  localStrict: `${DIR}/closure-b-local-strict.json`,
  localEmulator: `${DIR}/closure-b-local-emulator.json`,
  runVsRun: `${DIR}/closure-b-pass-1-vs-pass-2.json`,
  strictVsPass1: `${DIR}/closure-b-strict-vs-pass-1.json`,
  strictVsPass2: `${DIR}/closure-b-strict-vs-pass-2.json`,
  emulatorVsPass1: `${DIR}/closure-b-emulator-vs-pass-1.json`,
  emulatorVsPass2: `${DIR}/closure-b-emulator-vs-pass-2.json`,
};

/** [file key, production fixture key, other fixture key, the other is local]. */
export const COMPARISONS = [
  ["runVsRun", "pass1", "pass2", false],
  ["strictVsPass1", "pass1", "localStrict", true],
  ["strictVsPass2", "pass2", "localStrict", true],
  ["emulatorVsPass1", "pass1", "localEmulator", true],
  ["emulatorVsPass2", "pass2", "localEmulator", true],
];

export const KNOWN_IDS = [
  "KD-WEB-PERCENT-INSTALLATION",
  "KD-WEB-FETCH-TAG-NUMBER",
  "KD-WEB-TRANSPORT-ENCODING",
  "KD-WEB-VARY",
  "KD-WEB-INSTALLATIONS-HARNESS",
];

/** The closed table: every file of DIR, and the known differences, with its sha256. */
export const PINS = JSON.parse(
  readFileSync(new URL("./evidence-pins.json", import.meta.url), "utf8"),
);

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const render = (value) => JSON.stringify(value, null, 2) + "\n";

/** The committed form of one comparison. */
export function comparison(left, right, local) {
  const result = compare(left, right, { local });
  return {
    schema: "rc-closure-b-comparison/1",
    kind: local ? "production-vs-local" : "production-vs-production",
    rows: result.rows,
    counts: result.counts,
    table: result.table,
  };
}

export const CLOSURE = "spec/compatibility/closure/REMOTE-CONFIG.json";
export const CONDITIONS = {
  fetch: "REMOTE-CONFIG/client-fetch-and-activate",
  realtime: "REMOTE-CONFIG/realtime-updates",
};

/**
 * The condition a row belongs to: the realtime steps, the stream, the listener's updates and every
 * fetch a context made after its stream opened (the SDK's re-fetch on a frame) are realtime-updates;
 * the rest (installations, the first fetches, the SDK's fetch results, steps t1 and f-*) is
 * client-fetch-and-activate.
 */
export function conditionCounts(table) {
  const empty = () => ({ MATCH: 0, MATCH_LAYOUT: 0, KNOWN_DIFFERENCE: 0, MISMATCH: 0, UNKNOWN: 0 });
  const out = { fetch: { rows: 0, counts: empty() }, realtime: { rows: 0, counts: empty() } };
  const streamed = new Set();
  for (const row of table) {
    const context = /^(one|two)-/.exec(row.id)?.[1];
    if (context && row.id.endsWith("-realtime")) streamed.add(context);
    const realtime =
      row.id.startsWith("step-r") ||
      row.id.endsWith("-realtime") ||
      row.id.endsWith("-updates") ||
      Boolean(
        context && streamed.has(context) && row.id.endsWith("-fetch") && !row.id.includes("-sdk-"),
      );
    const condition = realtime ? "realtime" : "fetch";
    out[condition].counts[row.verdict] += 1;
    out[condition].rows += 1;
  }
  return out;
}

/** Problems of one fixture: sanitised, a complete pass with nothing open. */
export function fixtureProblems(path, bytes) {
  let fixture;
  try {
    fixture = JSON.parse(bytes);
  } catch {
    return [`${path}: not JSON`];
  }
  const problems = [];
  try {
    assertSanitised(fixture);
  } catch (error) {
    problems.push(`${path}: ${error.message}`);
  }
  problems.push(...settlementProblems(fixture).map((problem) => `${path}: ${problem}`));
  return problems;
}

/** Verifies the evidence of one git revision (`list`, `read` as gitReaders). Empty: valid. */
export function verifyEvidence({ list, read, pins = PINS }) {
  const problems = [];
  const expected = [...Object.values(FILES), KNOWN].toSorted();
  if (!isDeepStrictEqual(Object.keys(pins).toSorted(), expected))
    return [`the pins are not the evidence files: ${Object.keys(pins).join(", ")}`];
  let lock = {};
  try {
    lock = JSON.parse(read(RECORD_LOCK)).records ?? {};
  } catch {
    lock = {};
  }
  for (const pass of [FILES.pass1, FILES.pass2])
    if (lock[pass] !== pins[pass]) problems.push(`${pass}: its pin differs from ${RECORD_LOCK}`);
  const listed = list(DIR)
    .map((name) => `${DIR}/${name}`)
    .toSorted();
  const pinned = Object.keys(pins)
    .filter((path) => path.startsWith(`${DIR}/`))
    .toSorted();
  for (const path of listed) if (!pinned.includes(path)) problems.push(`${path}: not pinned`);
  for (const path of pinned)
    if (!listed.includes(path)) problems.push(`${path}: pinned but absent`);
  const files = {};
  for (const [path, digest] of Object.entries(pins)) {
    const bytes = read(path);
    if (bytes === null) {
      problems.push(`${path}: unreadable`);
      continue;
    }
    if (sha256(bytes) !== digest) problems.push(`${path}: sha256 differs from its pin`);
    files[path] = bytes;
  }
  if (problems.length) return problems;
  const known = JSON.parse(files[KNOWN]).map((entry) => entry.id);
  if (!isDeepStrictEqual(known, KNOWN_IDS))
    problems.push(`${KNOWN}: the ids differ from the pinned ids`);
  for (const key of ["pass1", "pass2", "localStrict", "localEmulator"])
    problems.push(...fixtureProblems(FILES[key], files[FILES[key]]));
  if (problems.length) return problems;
  const fixture = (key) => JSON.parse(files[FILES[key]]);
  for (const [key, left, right, local] of COMPARISONS) {
    const recomputed = comparison(fixture(left), fixture(right), local);
    let committed;
    try {
      committed = JSON.parse(files[FILES[key]]);
    } catch {
      problems.push(`${FILES[key]}: not JSON`);
      continue;
    }
    if (!isDeepStrictEqual(committed, recomputed))
      problems.push(`${FILES[key]}: differs from the recomputed comparison`);
    if (recomputed.counts.MISMATCH + recomputed.counts.UNKNOWN > 0)
      problems.push(
        `${FILES[key]}: ${recomputed.counts.MISMATCH} MISMATCH, ${recomputed.counts.UNKNOWN} UNKNOWN`,
      );
  }
  if (problems.length) return problems;
  // The closure record states each condition's counts and pins: they are the recomputed ones.
  let closure = null;
  try {
    closure = JSON.parse(read(CLOSURE));
  } catch {
    closure = null;
  }
  for (const [condition, id] of Object.entries(CONDITIONS)) {
    const record = closure?.conditions?.find((c) => c.conditionId === id);
    if (!record) {
      problems.push(`${CLOSURE}: no ${id}`);
      continue;
    }
    for (const key of ["runVsRun", "strictVsPass1", "strictVsPass2"]) {
      const [, left, right, local] = COMPARISONS.find(([k]) => k === key);
      const expectedCounts = conditionCounts(
        comparison(fixture(left), fixture(right), local).table,
      )[condition];
      if (!isDeepStrictEqual(record.comparisons?.[key], expectedCounts))
        problems.push(`${CLOSURE}: ${id} ${key} differs from the recomputed counts`);
    }
    const evidence = (record.productionEvidence ?? [])
      .filter(({ fixturePath }) => fixturePath.startsWith(DIR + "/"))
      .map(({ fixturePath, fixtureSha256 }) => [fixturePath, fixtureSha256]);
    if (
      !isDeepStrictEqual(evidence, [
        [FILES.pass1, pins[FILES.pass1]],
        [FILES.pass2, pins[FILES.pass2]],
      ])
    )
      problems.push(`${CLOSURE}: ${id} does not cite the two pinned passes`);
  }
  return problems;
}

function write(args) {
  const outputs = Object.values(FILES);
  for (const path of outputs) if (existsSync(join(ROOT, path))) throw new Error(`${path} exists`);
  const fixtures = {};
  for (const [key, flag] of [
    ["pass1", "pass-1"],
    ["pass2", "pass-2"],
    ["localStrict", "local-strict"],
    ["localEmulator", "local-emulator"],
  ]) {
    if (!args[flag]) throw new Error(`--${flag} is required`);
    fixtures[key] = sanitise(args[flag]);
  }
  const bytes = {};
  for (const key of Object.keys(fixtures)) bytes[FILES[key]] = render(fixtures[key]);
  for (const [key, left, right, local] of COMPARISONS)
    bytes[FILES[key]] = render(comparison(fixtures[left], fixtures[right], local));
  mkdirSync(join(ROOT, DIR), { recursive: true });
  for (const path of outputs) writeFileSync(join(ROOT, path), bytes[path], { flag: "wx" });
  for (const path of [...outputs, KNOWN])
    console.log(`${path} ${sha256(readFileSync(join(ROOT, path)))}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, "")] = rest[i + 1];
  if (command === "write") write(args);
  else if (command === "check") {
    const problems = verifyEvidence(gitReaders(args.rev ?? "HEAD", args.repo ?? ROOT));
    for (const problem of problems) console.error(problem);
    process.exitCode = problems.length ? 1 : 0;
    if (!problems.length) console.log("remote-config-web evidence: valid");
  } else throw new Error("usage: evidence.mjs write ... | check [--rev <revision>]");
}
