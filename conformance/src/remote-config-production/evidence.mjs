// The committed Remote Config observation fixtures, their comparisons and the check that binds them.
//
//   node src/remote-config-production/evidence.mjs write --production <run dir>
//     --local-strict <run dir> --local-emulator <run dir>
//       sanitises the three runs into conformance/remote-config-production/ (new files only), writes
//       the two comparisons, and prints the sha256 of each file for PINS
//   node src/remote-config-production/evidence.mjs check [--rev <git revision>] [--repo <dir>]
//       verifies the files of the revision (default HEAD) of the repository (default this one),
//       read as git blobs
//
// The check reads every input from git objects, never from the working tree: the directory listing
// must be exactly the pinned files (no extra and no missing file), each file must have its pinned
// sha256, every fixture must be a complete, fully answered and sanitised run whose rows are exactly
// the cases of the plan (CASES, in order), and each comparison
// must equal the comparison recomputed from the pinned fixtures and the pinned known differences.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { compareRuns } from "./judge.mjs";
import { PLACEHOLDERS, decodedForms, readRun, sanitiseRun } from "./sanitise.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DIR = "conformance/remote-config-production";
export const KNOWN = "conformance/src/remote-config-production/known-differences.json";

/**
 * The RC-OBSERVE-V2-3 recording (2026-11-24) and two local runs of the same recorder plan with the
 * same raw handlers (functions/index.cjs; coordinator ruling 4).
 */
export const FILES = {
  production: `${DIR}/observe-v23-production.json`,
  localStrict: `${DIR}/observe-v23-local-strict.json`,
  localEmulator: `${DIR}/observe-v23-local-emulator.json`,
  strict: `${DIR}/observe-v23-strict-vs-production.json`,
  emulator: `${DIR}/observe-v23-emulator-vs-production.json`,
};

/** The closed table: every file of DIR, and the known differences, with its sha256. */
export const PINS = {
  [FILES.production]: "2496056c2cbaf085551133fd97cfa9358fd2c5ff22c943724327e194460edc75",
  [FILES.localStrict]: "e9772ab05dea3e57b85e840b8beae8cc9ff819491732a393d354392c30a5c4c4",
  [FILES.localEmulator]: "9d1ce70c40e784e84ef1f624f5d33b181c8fdb83a0b7ffe94d7bef45c624fb64",
  [FILES.strict]: "f343c37a7bc1943abfe2e0bf25f800fef1d6fe1a1fb4b2f42bc62551f53a9d8d",
  [FILES.emulator]: "a61f9e069e773a34b6742b2e014bd82f869c247024062ac9433d6cd3f221274f",
  [KNOWN]: "fe11a9434b8eabd5938371e577f743a9f735f6e6d5fe21e5a57609abb798652c",
};

/** The trust table's six inputs, the record lock and the known differences they must carry. */
export const TRUST_INPUTS = [...Object.values(FILES), KNOWN].toSorted();
export const RECORD_LOCK = "spec/compatibility/closure/record-digests.json";
export const KNOWN_IDS = ["KD-MEMBER-ORDER"];
/** The content of each known-difference rule, so a rule cannot widen behind its id (ruling 5). */
export const KNOWN_RULES = [
  {
    id: "KD-MEMBER-ORDER",
    rows: ["*"],
    fields: [],
    fieldSuffixes: [":member-order"],
    appliesTo: ["production-vs-local"],
  },
];

/** The closed list of cases of the recorder plan, in request order. */
export const CASES = [
  "a-client",
  "a-server",
  "c0-publish",
  ...Array.from({ length: 24 }, (_, i) => `s-validate-${String(i).padStart(2, "0")}`),
  "s1-publish",
  "s2-data-plane",
  "s3-server-admin",
  "s4-wildcard",
  "s5-rollback",
  "s6-server",
  "c1-publish",
  "c2-publish",
  "c3-publish",
  "c4-rollback",
  "c5-client",
  "h-client-history",
  "h-server-history",
  "g-client",
  "g-server",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The comparison document of one local profile against the production fixture. */
export function comparison({ profile, production, local, known }) {
  const entries = JSON.parse(known.bytes).entries;
  const result = compareRuns(JSON.parse(production.bytes), JSON.parse(local.bytes), {
    known: entries,
    kind: "production-vs-local",
  });
  return {
    kind: "remote-config-comparison-v1",
    comparison: "production-vs-local",
    profile,
    inputs: {
      production: sha256(production.bytes),
      local: sha256(local.bytes),
      knownDifferences: sha256(known.bytes),
    },
    knownDifferences: entries
      .filter((entry) => entry.appliesTo.includes("production-vs-local"))
      .map((entry) => ({
        id: entry.id,
        rows: result.rows.filter((row) => row.knownDifferences.includes(entry.id)).length,
      })),
    counts: result.counts,
    rows: result.rows,
  };
}

const render = (value) => JSON.stringify(value, null, 2) + "\n";

/**
 * Problems of one fixture: incomplete, unanswered rows, or a value that is not sanitised. `cases`
 * is the plan's case list; `corpusNumber(digits)` admits a long digit run the corpus itself sends
 * (the closure corpus's largest version and zero-padded Installation ids).
 */
export function fixtureProblems(
  name,
  bytes,
  target,
  { cases: plan = CASES, corpusNumber = () => false } = {},
) {
  const problems = [];
  let fixture;
  try {
    fixture = JSON.parse(bytes);
  } catch {
    return [`${name}: not JSON`];
  }
  if (fixture.kind !== "remote-config-observation-rows") problems.push(`${name}: wrong kind`);
  if (fixture.target !== target) problems.push(`${name}: target is not ${target}`);
  if (fixture.complete !== true) problems.push(`${name}: the run was not complete`);
  if (!Array.isArray(fixture.open) || fixture.open.length)
    problems.push(`${name}: the run left open items`);
  for (const row of fixture.rows ?? [])
    if (row.phase !== "response-persisted" || typeof row.status !== "number")
      problems.push(`${name}: ${row.case} is not an answered row`);
  const cases = Array.isArray(fixture.rows) ? fixture.rows.map((row) => row.case) : [];
  if (!isDeepStrictEqual(cases, plan))
    problems.push(`${name}: the rows are not the cases of the plan`);
  // Plain and encoded (percent-escaped, base64 or base64url) forms of the text.
  const found = new Set();
  for (const text of decodedForms(bytes.toString("utf8"))) {
    if (/etag-[0-9]+-/.test(text)) found.add(`${name}: a numeric ETag`);
    if ((text.match(/[0-9]{11,}/g) ?? []).some((digits) => !corpusNumber(digits)))
      found.add(`${name}: a number of 11 or more digits`);
    const emails =
      text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? [];
    if (emails.some((email) => email !== PLACEHOLDERS.email))
      found.add(`${name}: an e-mail address`);
    for (const match of text.matchAll(/projects\/([^/"\\?]+)/g))
      if (match[1] !== PLACEHOLDERS.project && match[1] !== PLACEHOLDERS.number)
        found.add(`${name}: a project id other than ${PLACEHOLDERS.project}`);
  }
  problems.push(...found);
  return problems;
}

/**
 * Verifies the evidence. `list(dir)` returns the file names of a directory and `read(path)` the
 * bytes of a file (or null), both of one git revision. Returns the list of problems (empty: valid).
 */
export function verifyEvidence({ list, read, pins = PINS }) {
  const problems = [];
  // The closed table: exactly the trust table's inputs, whatever pins the caller supplies.
  const inputs = Object.keys(pins).toSorted();
  if (!isDeepStrictEqual(inputs, TRUST_INPUTS))
    return [`the pins are not the trust table's inputs: ${inputs.join(", ")}`];
  // Provenance: the production fixture's digest is also pinned outside this module, in the
  // closure record lock, beside the coordinator's private manifest of the raw recording.
  const lock = read(RECORD_LOCK);
  let lockDigest = null;
  try {
    lockDigest = JSON.parse(lock).records[FILES.production] ?? null;
  } catch {
    lockDigest = null;
  }
  if (lockDigest !== pins[FILES.production])
    problems.push(`${FILES.production}: its pin differs from ${RECORD_LOCK}`);
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
  const knownIds = (known?.entries ?? []).map((entry) => entry.id);
  if (!isDeepStrictEqual(knownIds, KNOWN_IDS))
    problems.push(`${KNOWN}: the entries are not ${KNOWN_IDS.join(", ")}`);
  const rules = (known?.entries ?? []).map(({ id, rows, fields, fieldSuffixes, appliesTo }) => ({
    id,
    rows,
    fields,
    fieldSuffixes,
    appliesTo,
  }));
  if (knownIds.length === KNOWN_IDS.length && !isDeepStrictEqual(rules, KNOWN_RULES))
    problems.push(`${KNOWN}: a rule's rows, fields or scope differ from the pinned rules`);
  problems.push(...fixtureProblems(FILES.production, files[FILES.production].bytes, "production"));
  problems.push(...fixtureProblems(FILES.localStrict, files[FILES.localStrict].bytes, "local"));
  problems.push(...fixtureProblems(FILES.localEmulator, files[FILES.localEmulator].bytes, "local"));
  for (const [profile, local, path] of [
    ["strict", FILES.localStrict, FILES.strict],
    ["emulator", FILES.localEmulator, FILES.emulator],
  ]) {
    const expected = comparison({
      profile,
      production: files[FILES.production],
      local: files[local],
      known: files[KNOWN],
    });
    let committed;
    try {
      committed = JSON.parse(files[path].bytes);
    } catch {
      problems.push(`${path}: not JSON`);
      continue;
    }
    if (!isDeepStrictEqual(committed, expected))
      problems.push(`${path}: differs from the recomputed comparison`);
  }
  return problems;
}

/** git-object readers for one revision. */
export function gitReaders(rev = "HEAD", cwd = ROOT) {
  const git = (args) => execFileSync("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return {
    list: (dir) =>
      git(["ls-tree", "--name-only", `${rev}:${dir}`])
        .toString("utf8")
        .split("\n")
        .filter(Boolean),
    read: (path) => {
      try {
        return git(["cat-file", "blob", `${rev}:${path}`]);
      } catch {
        return null;
      }
    },
  };
}

function write(args) {
  const outputs = [
    FILES.production,
    FILES.localStrict,
    FILES.localEmulator,
    FILES.strict,
    FILES.emulator,
  ];
  for (const path of outputs) if (existsSync(join(ROOT, path))) throw new Error(`${path} exists`);
  const bytes = {};
  for (const [path, dir] of [
    [FILES.production, args.production],
    [FILES.localStrict, args["local-strict"]],
    [FILES.localEmulator, args["local-emulator"]],
  ])
    bytes[path] = Buffer.from(render(sanitiseRun(readRun(dir))));
  const known = { bytes: readFileSync(join(ROOT, KNOWN)) };
  for (const [profile, local, path] of [
    ["strict", FILES.localStrict, FILES.strict],
    ["emulator", FILES.localEmulator, FILES.emulator],
  ])
    bytes[path] = Buffer.from(
      render(
        comparison({
          profile,
          production: { bytes: bytes[FILES.production] },
          local: { bytes: bytes[local] },
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
    if (!problems.length) console.log("remote-config-production evidence: valid");
  } else throw new Error("usage: evidence.mjs write ... | check [--rev <revision>]");
}
