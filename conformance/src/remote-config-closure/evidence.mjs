// The committed RC-CLOSURE-A evidence: the two sanitised production passes, a local strict and a
// local emulator run of the same recorder, their comparisons, and the check that binds them.
//
//   node src/remote-config-closure/evidence.mjs write --pass-1 <run dir> --pass-2 <run dir>
//     --local-strict <run dir> --local-emulator <run dir>
//       sanitises the four runs into conformance/remote-config-closure/ (new files only), writes
//       the five comparisons, and prints the sha256 of each file for PINS
//   node src/remote-config-closure/evidence.mjs check [--rev <git revision>] [--repo <dir>]
//       verifies the files of the revision (default HEAD), read as git blobs
//
// As the RC-OBSERVE-V2-3 evidence (../remote-config-production/evidence.mjs): the directory must be
// exactly the pinned files, each with its pinned sha256; both pass fixtures are also pinned in the
// closure record lock; every fixture is a complete, answered, sanitised run whose rows are exactly
// CASES; every comparison equals the one recomputed from the pinned fixtures and known differences;
// the known differences are exactly the pinned rules.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { fixtureProblems, gitReaders } from "../remote-config-production/evidence.mjs";
import { compareRuns } from "../remote-config-production/judge.mjs";
import { readRun, sanitiseRun } from "../remote-config-production/sanitise.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DIR = "conformance/remote-config-closure";
export const KNOWN = "conformance/src/remote-config-closure/known-differences.json";
export const RECORD_LOCK = "spec/compatibility/closure/record-digests.json";

export const FILES = {
  pass1: `${DIR}/closure-a-pass-1.json`,
  pass2: `${DIR}/closure-a-pass-2.json`,
  localStrict: `${DIR}/closure-a-local-strict.json`,
  localEmulator: `${DIR}/closure-a-local-emulator.json`,
  runVsRun: `${DIR}/closure-a-pass-1-vs-pass-2.json`,
  strictVsPass1: `${DIR}/closure-a-strict-vs-pass-1.json`,
  strictVsPass2: `${DIR}/closure-a-strict-vs-pass-2.json`,
  emulatorVsPass1: `${DIR}/closure-a-emulator-vs-pass-1.json`,
  emulatorVsPass2: `${DIR}/closure-a-emulator-vs-pass-2.json`,
};

/** The comparisons: [file key, left fixture key, right fixture key, kind, profile]. */
export const COMPARISONS = [
  ["runVsRun", "pass1", "pass2", "production-vs-production", null],
  ["strictVsPass1", "pass1", "localStrict", "production-vs-local", "strict"],
  ["strictVsPass2", "pass2", "localStrict", "production-vs-local", "strict"],
  ["emulatorVsPass1", "pass1", "localEmulator", "production-vs-local", "emulator"],
  ["emulatorVsPass2", "pass2", "localEmulator", "production-vs-local", "emulator"],
];

/** The closed table: every file of DIR, and the known differences, with its sha256. */
export const PINS = {
  [FILES.pass1]: "9abb4ea8c793b25db731f67785cb2f2d055afc3687f7d17178e96ef946e4cdac",
  [FILES.pass2]: "79d25d013bf9767f9f23b0e292ba272019791c1b254e9bea24e2b81b44549058",
  [FILES.localStrict]: "e7fe2b3d1dc15defb5fb7bd9ba621a99b200c165582eb04d63da47a6d7b9b3b6",
  [FILES.localEmulator]: "6154bce0f589587faa3235bd9c555ab025e08e2646414fb1bc2e05f0cf64a610",
  [FILES.runVsRun]: "7a85bc4626f07b76ae210a38c8736d40c56d16912ced54a5707bc835a17f570e",
  [FILES.strictVsPass1]: "5338c26ec2f9c6813b17825c3c03781e775ff7036eb9bcaa8ed1cc02ccb7ed9e",
  [FILES.strictVsPass2]: "4ea5a384ef99809d60e81d8509f3295f1b140112f3737e6ef7a0332668e12533",
  [FILES.emulatorVsPass1]: "a87681e862bf15deacb4dc9c1655f33fa0270cda0d75a91190338979b34bf837",
  [FILES.emulatorVsPass2]: "97eebb86dec26eb592b742ce92137e3ee15106526d7a6a63bbe4eede96525d85",
  [KNOWN]: "3bf385a7271c432a12f54ee767acdc5c56467df7c408eac676d8e81cf7c1cad0",
};

export const TRUST_INPUTS = [...Object.values(FILES), KNOWN].toSorted();

/** The defaults files, whose entry order is compared exactly (ruling 6; ruling 11 item 5). */
export const DEFAULTS_ROWS = ["d-json", "d-xml", "d-plist", "d-explicit"];

/** The content of each known-difference rule, so a rule cannot widen behind its id. */
export const KNOWN_RULES = [
  {
    id: "KD-MEMBER-ORDER",
    rows: ["*"],
    exceptRows: DEFAULTS_ROWS,
    fields: [],
    fieldSuffixes: [":member-order"],
    appliesTo: ["production-vs-local"],
  },
  {
    id: "KD-PRODUCTION-MEMBER-ORDER",
    rows: ["*"],
    exceptRows: DEFAULTS_ROWS,
    fields: [],
    fieldSuffixes: [":member-order"],
    appliesTo: ["production-vs-production"],
  },
];

/** The closed list of the pass's Remote Config cases, in request order (corpus.mjs, record.mjs). */
export const CASES = [
  "a-client",
  "a-server",
  "r-identity",
  "r-if-none-match",
  "r-explicit",
  "r-number",
  "r-version-current",
  "r-version-snake",
  "r-version-zero",
  "r-version-missing",
  "r-version-invalid",
  "r-unknown-namespace",
  "r-unauthenticated",
  "v-before",
  "v-missing-precondition",
  "v-malformed-tag",
  "v-wildcard",
  ...[
    "empty",
    "description-only",
    "kind-invalid",
    "boolean-invalid",
    "number-invalid",
    "json-invalid",
    "bad-type",
    "missing-reference",
    "duplicate-parameter",
    "duplicate-conditions",
    "unknown-field",
    "parameters-not-object",
    "groups-not-object",
    "condition-name-empty",
    "parameter-key-leading-digit",
    "parameter-key-unicode",
    "parameter-key-underscore",
    "parameter-key-256",
    "parameter-key-257",
    "condition-name-256",
    "condition-name-257",
    "group-name-257",
    "description-1024",
    "description-1025",
    "description-utf8-1025",
    "parameter-count-3000",
    "parameter-count-3001",
    "condition-count-2000",
    "condition-count-2001",
  ].map((name) => `v-${name}`),
  ...[
    "percent-zero",
    "percent-fraction",
    "percent-fraction-overprecision",
    "percent-negative",
    "percent-above-max",
    "percent-above",
    "percent-range",
    "percent-inverted-range",
    "percent-seeded",
    "percent-seeded-range",
    "conjunction",
    "disjunction",
    "parenthesized",
    "negation",
    "app-build-number",
    "app-build-string",
    "app-version-semver",
    "app-version-prerelease",
    "app-version-regex",
    "app-version-malformed-regex",
    "app-browser",
    "app-browser-unknown",
    "app-os-version",
    "install-id",
    "install-id-bad",
    "custom-number",
    "custom-exact",
    "custom-regex",
    "custom-semver",
    "first-open-time",
    "first-open-lt",
    "first-open-gt-zone",
    "device-country",
    "device-invalid-country",
    "device-language",
    "device-os",
    "device-date-time",
    "date-time-before-tz",
    "date-time-after-nozone",
    "date-time-before-invalid-zone",
    "app-build-numeric-method",
    "app-version-semver-method",
    "invalid-expression",
    "install-id-size-50",
    "install-id-size-51",
    "custom-key-250",
    "custom-key-251",
  ].map((name) => `v-cond-${name}`),
  "v-after",
  "p1-publish",
  "d-json",
  "d-xml",
  "d-plist",
  "d-explicit",
  "d-omitted",
  "d-invalid",
  "p2-missing",
  "p3-stale",
  "p4-malformed",
  "p5-wildcard",
  "p6a-publish",
  "p6b-same",
  "p7-race-a",
  "p7-race-b",
  "p8-current",
  "h-page",
  "h-next",
  "h-end-version",
  "h-end-version-zero",
  "h-end-version-negative",
  "h-start",
  "h-start-plus",
  "h-end",
  "h-end-minus",
  "h-window",
  "h-same-bounds",
  "h-reversed",
  "h-old-end",
  "h-start-invalid",
  "h-token-invalid",
  "h-size-negative",
  "h-size-zero",
  "k1-rollback",
  "k2-rollback-unknown",
  "k3-version",
  "k4-version-snake",
  ...Array.from({ length: 24 }, (_, i) => `s-validate-${String(i).padStart(2, "0")}`),
  "s1-publish",
  "s2-data-plane",
  "s3-server-admin",
  "s4-wildcard",
  "s5-rollback",
  "s6-server",
  "s7-history",
  "c9-restore",
  "c10-client",
  "c11-history",
  "g-client",
  "g-server",
];

/**
 * The six stage-A conditions and the comparison rows each one owns. Every comparison row belongs
 * to exactly one condition (the closure test checks it).
 */
export const CONDITION_ROWS = {
  "REMOTE-CONFIG/template-read": (id) => /^(?:a-|r-|d-|g-)/.test(id),
  "REMOTE-CONFIG/template-validation": (id) => id.startsWith("v-"),
  "REMOTE-CONFIG/template-publish": (id) => /^p[0-9]/.test(id),
  "REMOTE-CONFIG/version-history-and-rollback": (id) => /^(?:h-|k[0-9]|c[0-9])/.test(id),
  "REMOTE-CONFIG/server-template-evaluation": (id) => /^s(?:-|[0-9])/.test(id),
  "REMOTE-CONFIG/publish-trigger": (id) => /^(?:event|summary:)/.test(id),
};

/** The condition of a comparison row, or null. */
export function conditionOf(id) {
  const owners = Object.entries(CONDITION_ROWS).filter(([, owns]) => owns(id));
  return owners.length === 1 ? owners[0][0] : null;
}

/** The counts of one condition's rows in a comparison document. */
export function conditionCounts(document, conditionId) {
  const counts = { MATCH: 0, MATCH_LAYOUT: 0, KNOWN_DIFFERENCE: 0, MISMATCH: 0, UNKNOWN: 0 };
  let rows = 0;
  for (const row of document.rows)
    if (conditionOf(row.id) === conditionId) {
      counts[row.status] += 1;
      rows += 1;
    }
  return { rows, counts };
}

/**
 * Long digit runs the corpus sends itself: the largest version (r-version-missing, k2) and the
 * zero-padded Installation ids (`c` and 21 digits with at most two significant ones).
 */
export const corpusNumber = (digits) =>
  digits === "9223372036854775807" || /^0+[0-9]{0,2}$/.test(digits);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const render = (value) => JSON.stringify(value, null, 2) + "\n";

/** The comparison document of `right` against `left`. */
export function comparison({ kind, profile, left, right, known }) {
  const entries = JSON.parse(known.bytes).entries;
  const result = compareRuns(JSON.parse(left.bytes), JSON.parse(right.bytes), {
    known: entries,
    kind,
  });
  return {
    kind: "remote-config-comparison-v1",
    comparison: kind,
    profile,
    inputs: {
      left: sha256(left.bytes),
      right: sha256(right.bytes),
      knownDifferences: sha256(known.bytes),
    },
    knownDifferences: entries
      .filter((entry) => entry.appliesTo.includes(kind))
      .map((entry) => ({
        id: entry.id,
        rows: result.rows.filter((row) => row.knownDifferences.includes(entry.id)).length,
      })),
    counts: result.counts,
    rows: result.rows,
  };
}

/** The server rows that carry the four server conditions the emulator profile accepts. */
export const CARRIERS = ["s1-publish", "s2-data-plane", "s3-server-admin", "s4-wildcard"];

/**
 * Problems of one emulator comparison (rulings 12 and 14): exactly 28 MISMATCH rows, the 24
 * validations production refused with 400 that the emulator accepts with 200, each a strict MATCH,
 * and the four carriers, each differing exactly by the four accepted server conditions.
 */
export function emulatorProblems({ name, emulatorDoc, strictDoc, pass, emulator }) {
  const problems = [];
  const status = (fixture) => new Map(fixture.rows.map((row) => [row.case, row.status]));
  const production = status(pass);
  const local = status(emulator);
  const strictRows = new Map(strictDoc.rows.map((row) => [row.id, row.status]));
  const mismatches = emulatorDoc.rows.filter((row) => row.status === "MISMATCH");
  if (mismatches.length !== 28)
    problems.push(`${name}: ${mismatches.length} MISMATCH rows, not 28`);
  if (emulatorDoc.counts.UNKNOWN) problems.push(`${name}: UNKNOWN rows`);
  const conditions = ["literal_false", "literal_true", "not", "or"].map(
    (c) => `body.parameters.fireemu_obs_top.conditionalValues.fireemu_obs_${c}:missing-left`,
  );
  const escapes = [
    "escapes:value:/conditions/20/expression",
    "escapes:value:/conditions/21/expression",
  ];
  for (const row of mismatches) {
    if (CARRIERS.includes(row.id)) {
      const expected = [
        "skeletonBytes",
        ...(row.id === "s2-data-plane" ? [] : escapes),
        "body.conditions:length",
        ...conditions,
      ];
      if (!isDeepStrictEqual(row.differences, expected) || strictRows.get(row.id) === "MISMATCH")
        problems.push(`${name}: ${row.id} differs by more than the accepted server conditions`);
      continue;
    }
    const refusal = row.id.startsWith("v-cond-") || /^s-validate-2[0-3]$/.test(row.id);
    if (
      !refusal ||
      production.get(row.id) !== 400 ||
      local.get(row.id) !== 200 ||
      strictRows.get(row.id) !== "MATCH"
    )
      problems.push(`${name}: ${row.id} is not a strict-only refusal`);
  }
  for (const id of CARRIERS)
    if (!mismatches.some((row) => row.id === id))
      problems.push(`${name}: ${id} is not a carrier difference`);
  return problems;
}

/** Verifies the evidence of one git revision (`list`, `read` as gitReaders). Empty: valid. */
export function verifyEvidence({ list, read, pins = PINS }) {
  const problems = [];
  const inputs = Object.keys(pins).toSorted();
  if (!isDeepStrictEqual(inputs, TRUST_INPUTS))
    return [`the pins are not the trust table's inputs: ${inputs.join(", ")}`];
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
    files[path] = { bytes };
  }
  if (problems.length) return problems;
  let known = null;
  try {
    known = JSON.parse(files[KNOWN].bytes);
  } catch {
    known = null;
  }
  const rules = (known?.entries ?? []).map(
    ({ id, rows, exceptRows, fields, fieldSuffixes, appliesTo }) => ({
      id,
      rows,
      exceptRows,
      fields,
      fieldSuffixes,
      appliesTo,
    }),
  );
  if (!isDeepStrictEqual(rules, KNOWN_RULES))
    problems.push(`${KNOWN}: the rules differ from the pinned rules`);
  const options = { cases: CASES, corpusNumber };
  for (const key of ["pass1", "pass2"])
    problems.push(...fixtureProblems(FILES[key], files[FILES[key]].bytes, "production", options));
  for (const key of ["localStrict", "localEmulator"])
    problems.push(...fixtureProblems(FILES[key], files[FILES[key]].bytes, "local", options));
  if (problems.length) return problems;
  for (const [key, left, right, kind, profile] of COMPARISONS) {
    const expected = comparison({
      kind,
      profile,
      left: files[FILES[left]],
      right: files[FILES[right]],
      known: files[KNOWN],
    });
    let committed;
    try {
      committed = JSON.parse(files[FILES[key]].bytes);
    } catch {
      problems.push(`${FILES[key]}: not JSON`);
      continue;
    }
    if (!isDeepStrictEqual(committed, expected))
      problems.push(`${FILES[key]}: differs from the recomputed comparison`);
    // The closure's claim: strict matches both passes and the passes match each other, so a
    // forged local input that the judge flags never passes the check (ruling 11).
    if (profile !== "emulator" && expected.counts.MISMATCH + expected.counts.UNKNOWN > 0)
      problems.push(
        `${FILES[key]}: ${expected.counts.MISMATCH} MISMATCH, ${expected.counts.UNKNOWN} UNKNOWN`,
      );
  }
  if (problems.length) return problems;
  const doc = (key) => JSON.parse(files[FILES[key]].bytes);
  const fixture = (key) => JSON.parse(files[FILES[key]].bytes);
  for (const [key, strict, pass] of [
    ["emulatorVsPass1", "strictVsPass1", "pass1"],
    ["emulatorVsPass2", "strictVsPass2", "pass2"],
  ])
    problems.push(
      ...emulatorProblems({
        name: FILES[key],
        emulatorDoc: doc(key),
        strictDoc: doc(strict),
        pass: fixture(pass),
        emulator: fixture("localEmulator"),
      }),
    );
  return problems;
}

function write(args) {
  const outputs = Object.values(FILES);
  for (const path of outputs) if (existsSync(join(ROOT, path))) throw new Error(`${path} exists`);
  const bytes = {};
  for (const [key, dir] of [
    ["pass1", args["pass-1"]],
    ["pass2", args["pass-2"]],
    ["localStrict", args["local-strict"]],
    ["localEmulator", args["local-emulator"]],
  ]) {
    if (!dir) throw new Error(`--${key} is required`);
    bytes[FILES[key]] = Buffer.from(render(sanitiseRun(readRun(dir))));
  }
  const known = { bytes: readFileSync(join(ROOT, KNOWN)) };
  for (const [key, left, right, kind, profile] of COMPARISONS)
    bytes[FILES[key]] = Buffer.from(
      render(
        comparison({
          kind,
          profile,
          left: { bytes: bytes[FILES[left]] },
          right: { bytes: bytes[FILES[right]] },
          known,
        }),
      ),
    );
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
    if (!problems.length) console.log("remote-config-closure evidence: valid");
  } else throw new Error("usage: evidence.mjs write ... | check [--rev <revision>]");
}
