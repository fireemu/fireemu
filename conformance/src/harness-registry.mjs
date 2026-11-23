// The harness digests a recorded production row is bound to, in one place.
//
// A fixture row records the digest of the harness that recorded it. A check refuses (STALE_FIXTURE)
// a row whose recorded digest is not the digest of today's harness, so a change to what a row means
// cannot go unnoticed. Two digests exist:
//
//   raw      the historical one: the sources as text, joined by a newline, then the extra inputs.
//            Every recorded fixture holds a raw digest. A comment or a provenance SHA in a source
//            changes it, which is how a history rewrite made every stage-1 row stale.
//   scheme 2 the same inputs as a token stream from the parser: comments and whitespace do not
//            count, everything else does (identifiers, literals with their quotes, operators,
//            template text, and the semicolons the parser inserts at line breaks). Only .mjs and
//            .js are digested this way; data goes through `extra`.
//
// A recorded digest is accepted when it is today's raw or scheme-2 digest, or when a hop of
// harness-lineage.json connects it to today's scheme-2 digest. A hop is only sound if the recorded
// raw digest reproduces from the sources at the hop's commit and the scheme-2 digest of that commit
// equals today's, so the change between the recorded harness and today's is comments and
// whitespace and nothing else. Nothing is rewritten in a fixture.
//
// A second kind of hop, "unreached", connects a recorded digest across one approved change of a
// source whose changed path the recorded rows did not reach. The change is a condition of the
// closed table UNREACHED_CONDITIONS (its commit, the commit before it and the hash of its exact
// diff); a hop that names another one is refused. A hop is sound only when all of this holds, and
// each part fails closed:
//   - every input (sources and data) is read at the revision it is verified at, and a missing one
//     is refused;
//   - the recorded raw digest reproduces at the hop's commit, and the inputs there differ from the
//     condition's base by comments and whitespace only;
//   - the change from the base to the approved commit hashes to the approved diff and touches,
//     among the lane's inputs, exactly the files the condition names;
//   - the scheme-2 digest at the approved commit and of today's tree is the hop's, so nothing but
//     the change happened since;
//   - the condition holds for every recorded answer of the lane's fixture.
//
// A lane's digest may also read data (`extra`, `guarded` paths) or belong to a fixture that is not
// enrolled (WAIVED_FIXTURES, with the inputs it reads). A rewrite cannot follow those, so a rewrite
// of any of them is refused (rewriteReport).
//
//   node src/harness-registry.mjs verify [--json]     every enrolled lane, and every binding problem
//                                                     the release gate refuses (exit 1 on any)
//   node src/harness-registry.mjs paths               the repository paths a rewrite must show it
//   node src/harness-registry.mjs rewrite-check <f> [--head <sha>]
//                                                     what a rewrite of files does to each lane
//   node src/harness-registry.mjs unreached-hops --condition <name> [--write]
//                                                     the "unreached" hops a condition calls for
//                                                     (printed, or appended to the lineage)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "acorn";

import { AUTHORIZED_DOMAINS } from "./auth-account/authorized-domains.mjs";
import { BASELINE_CONFIG } from "./auth-account/corpus.mjs";
import { SANDBOX_BASELINE } from "./auth-config-sdk/sandbox-baseline.mjs";
import { ALIGN_WINDOW } from "./auth-mfa/session.mjs";
import { PRINCIPALS as AUTH_FS_CROSS_PRINCIPALS } from "./auth-fs-cross/corpus.mjs";
import { STAGE2_PRINCIPALS } from "./auth-fs-cross/programs-stage2.mjs";
import { CONFORMANCE_DIR, REPO_ROOT } from "./config.mjs";
import { isTransient } from "./fs-query-index/harness.mjs";
import { PRINCIPALS as FS_RULES_PRINCIPALS } from "./fs-rules/corpus.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const pubsubNames = JSON.parse(
  readFileSync(join(CONFORMANCE_DIR, "pubsub-resource-names-production.json"), "utf8"),
);

/** The files stage 2's recorded rows depend on (its runner and recorder are not among them). */
export const STAGE2_HARNESS_FILES = [
  "fs-rules/harness.mjs",
  "auth-credential/tokens.mjs",
  "auth-fs-cross/stage2-session.mjs",
  "auth-fs-cross/stage2-orchestrator.mjs",
  "auth-fs-cross/listen-grpc.mjs",
  "auth-fs-cross/sdk-client.mjs",
  "auth-fs-cross/sdk-driver.mjs",
  "auth-fs-cross/sdk-driver-wire.mjs",
  "auth-fs-cross/sdk-wire.mjs",
  "auth-fs-cross/sdk-operations.mjs",
  "auth-fs-cross/browser-driver.mjs",
  "auth-fs-cross/browser-page.mjs",
];

/** A data input of a digest (a path under conformance/) as this checkout has it. */
const readConformanceData = (path) => readFileSync(join(CONFORMANCE_DIR, path), "utf8");

/**
 * The lanes whose harness digest is bound here. `files` are under conformance/src and `extra` is
 * the JSON of the inputs that are data, not code. A lane's runner digests exactly this.
 */
export const HARNESS_LANES = {
  "pubsub-resource-names": {
    fixture: "pubsub-resource-names-production.json",
    files: [
      "pubsub-release/resource-names.mjs",
      "pubsub-production/rest.mjs",
      "pubsub-production/grpc.mjs",
      "pubsub-production/capture.mjs",
      "pubsub-production/limits.mjs",
      "pubsub-production/stream.mjs",
      "pubsub-production/stream-dlq-compare-core.mjs",
      "pubsub-production/stream-dlq-normalization.mjs",
      "pubsub-production/iam.mjs",
    ],
    extra: JSON.stringify({
      ...pubsubNames,
      programs: Object.fromEntries(
        Object.entries(pubsubNames.programs).map(([id, program]) => [
          id,
          Object.fromEntries(Object.entries(program).filter(([key]) => key !== "harnessDigest")),
        ]),
      ),
    }),
    guarded: [
      "conformance/pubsub-resource-names-production.json",
      "conformance/src/pubsub-release/fixtures/resource-names.fireemu.json",
    ],
  },
  "fs-rules": {
    fixture: "fs-rules-production.json",
    files: ["fs-rules/harness.mjs", "fs-rules/session.mjs", "auth-credential/tokens.mjs"],
    extra: JSON.stringify(FS_RULES_PRINCIPALS),
    guarded: ["conformance/src/fs-rules/corpus.mjs"],
  },
  "auth-fs-cross": {
    fixture: "auth-fs-cross-production.json",
    files: ["fs-rules/harness.mjs", "auth-fs-cross/session.mjs", "auth-credential/tokens.mjs"],
    extra: JSON.stringify(AUTH_FS_CROSS_PRINCIPALS),
    guarded: ["conformance/src/auth-fs-cross/corpus.mjs"],
  },
  "auth-fs-cross-stage2": {
    fixture: "auth-fs-cross-stage2-production.json",
    files: STAGE2_HARNESS_FILES,
    extra: JSON.stringify(STAGE2_PRINCIPALS),
    guarded: ["conformance/src/auth-fs-cross/programs-stage2.mjs"],
  },
  "auth-account": {
    fixture: "auth-account-production.json",
    files: ["auth-account/harness.mjs", "auth-account/session.mjs"],
    extra: JSON.stringify(BASELINE_CONFIG),
    guarded: ["conformance/src/auth-account/corpus.mjs"],
  },
  "auth-action": {
    fixture: "auth-action-production.json",
    files: [
      "auth-action/harness.mjs",
      "auth-action/session.mjs",
      "auth-credential/session.mjs",
      "auth-credential/tokens.mjs",
      "auth-account/harness.mjs",
      "auth-account/session.mjs",
    ],
    extra: `${JSON.stringify(BASELINE_CONFIG)}\n${JSON.stringify(AUTHORIZED_DOMAINS)}`,
    guarded: [
      "conformance/src/auth-account/corpus.mjs",
      "conformance/src/auth-account/authorized-domains.mjs",
    ],
  },
  "auth-config-sdk": {
    fixture: "auth-config-sdk-production.json",
    files: [
      "auth-config-sdk/harness.mjs",
      "auth-config-sdk/session.mjs",
      "auth-config-sdk/sdk.mjs",
      "auth-action/harness.mjs",
      "auth-credential/session.mjs",
      "auth-credential/tokens.mjs",
      "auth-account/harness.mjs",
    ],
    // The installed SDK versions are part of the digest, so the digest needs the dependencies.
    extra: () => `${JSON.stringify(SANDBOX_BASELINE)}\n${JSON.stringify(installedSdkVersions())}`,
    guarded: ["conformance/src/auth-config-sdk/sandbox-baseline.mjs"],
  },
  "auth-credential": {
    fixture: "auth-credential-production.json",
    files: [
      "auth-credential/harness.mjs",
      "auth-credential/session.mjs",
      "auth-credential/tokens.mjs",
      "auth-account/harness.mjs",
    ],
    extra: JSON.stringify(BASELINE_CONFIG),
    guarded: ["conformance/src/auth-account/corpus.mjs"],
  },
  "auth-mfa": {
    fixture: "auth-mfa-production.json",
    files: [
      "auth-mfa/harness.mjs",
      "auth-mfa/session.mjs",
      "auth-credential/session.mjs",
      "auth-credential/tokens.mjs",
      "auth-account/harness.mjs",
      "auth-account/session.mjs",
    ],
    extra: `${JSON.stringify(BASELINE_CONFIG)}\n${JSON.stringify(AUTHORIZED_DOMAINS)}\n${JSON.stringify(ALIGN_WINDOW)}`,
    guarded: [
      "conformance/src/auth-account/corpus.mjs",
      "conformance/src/auth-account/authorized-domains.mjs",
    ],
  },
  "fs-query-index": {
    fixture: "fs-query-index-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index.indexes.json"),
    guarded: ["conformance/fs-query-index.indexes.json"],
  },
  "fs-data-write-list": {
    fixture: "fs-data-write-list-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index.indexes.json"),
    guarded: ["conformance/fs-query-index.indexes.json"],
  },
  // The index-merge observation lane (lanes.mjs fs-query-index-merge): the same request layer,
  // with its own index file as the data its digest reads.
  "fs-query-index-merge": {
    fixture: "fs-query-index-merge-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge.indexes.json"),
    guarded: ["conformance/fs-query-index-merge.indexes.json"],
  },
  // The second index-merge observation lane (lanes.mjs fs-query-index-merge2): the same request
  // layer, with its own index file as the data its digest reads.
  "fs-query-index-merge2": {
    fixture: "fs-query-index-merge2-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge2.indexes.json"),
    guarded: ["conformance/fs-query-index-merge2.indexes.json"],
  },
  // Observation 2b-1 of the index-merge shapes (lanes.mjs fs-query-index-merge3): the same request
  // layer, with its own index file as the data its digest reads.
  "fs-query-index-merge3": {
    fixture: "fs-query-index-merge3-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge3.indexes.json"),
    guarded: ["conformance/fs-query-index-merge3.indexes.json"],
  },
  // Observation 2b-2 of the index-merge shapes (lanes.mjs fs-query-index-merge4): the same request
  // layer, with its own index file as the data its digest reads.
  "fs-query-index-merge4": {
    fixture: "fs-query-index-merge4-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge4.indexes.json"),
    guarded: ["conformance/fs-query-index-merge4.indexes.json"],
  },
  // Observation 2b-3 of the index-merge shapes (lanes.mjs fs-query-index-merge5): the same request
  // layer, with its own index file as the data its digest reads.
  "fs-query-index-merge5": {
    fixture: "fs-query-index-merge5-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge5.indexes.json"),
    guarded: ["conformance/fs-query-index-merge5.indexes.json"],
  },
  // Observation 2b-4 of the index-merge shapes (lanes.mjs fs-query-index-merge6): the same request
  // layer, with its own index file as the data its digest reads.
  "fs-query-index-merge6": {
    fixture: "fs-query-index-merge6-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge6.indexes.json"),
    guarded: ["conformance/fs-query-index-merge6.indexes.json"],
  },
  // Observation 2b-5 of the index-merge shapes (lanes.mjs fs-query-index-merge7): the same request
  // layer, with its own index file as the data its digest reads.
  "fs-query-index-merge7": {
    fixture: "fs-query-index-merge7-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge7.indexes.json"),
    guarded: ["conformance/fs-query-index-merge7.indexes.json"],
  },
  // Observation 2b-6 of the index-merge shapes (lanes.mjs fs-query-index-merge8): the same request
  // layer, with its own index file as the data its digest reads.
  "fs-query-index-merge8": {
    fixture: "fs-query-index-merge8-production.json",
    files: ["fs-query-index/harness.mjs", "fs-query-index/session.mjs"],
    extra: (readData = readConformanceData) => readData("fs-query-index-merge8.indexes.json"),
    guarded: ["conformance/fs-query-index-merge8.indexes.json"],
  },
  // FS-ENT-ORACLE: the pipeline lane's own copy of the query request layer (named database
  // support), without an index file.
  "fs-ent-pipeline": {
    fixture: "fs-ent-pipeline-production.json",
    files: ["fs-ent-pipeline/harness.mjs", "fs-ent-pipeline/session.mjs"],
    extra: "",
  },
  // FS-PIPELINE-REGEX (2026-11-10): the same request layer as the O-series lane, its own fixture.
  "fs-ent-pipeline-regex": {
    fixture: "fs-ent-pipeline-regex-production.json",
    files: ["fs-ent-pipeline/harness.mjs", "fs-ent-pipeline/session.mjs"],
    extra: "",
  },
  "fs-config-lifecycle": {
    fixture: "fs-config-lifecycle-production.json",
    files: [
      "fs-config-lifecycle/harness.mjs",
      "fs-config-lifecycle/session.mjs",
      "fs-config-lifecycle/grpc.mjs",
      "fs-config-lifecycle/exports.mjs",
    ],
    extra: "",
    noExtraTail: true,
    guarded: [],
  },
  // SECURETOKEN-BODY: the digest is the recorder's HARNESS_FILES (securetoken-body/judge.mjs)
  // joined by a newline, with no extra inputs.
  "securetoken-body": {
    fixture: "securetoken-body-production.json",
    files: [
      "securetoken-body/corpus.mjs",
      "securetoken-body/harness.mjs",
      "securetoken-body/judge.mjs",
      "securetoken-body/session.mjs",
      "securetoken-body/record.mjs",
      "securetoken-body/recording.mjs",
      "securetoken-body/preflight.mjs",
      "auth-account/harness.mjs",
      "auth-credential/tokens.mjs",
      "shared/ownership.mjs",
    ],
    extra: "",
    noExtraTail: true,
    guarded: [],
  },
};

/** The versions of the SDKs the AUTH-CONFIG-SDK harness drives, as installed. */
function installedSdkVersions() {
  const version = (name) =>
    JSON.parse(readFileSync(join(CONFORMANCE_DIR, "node_modules", name, "package.json"), "utf8"))
      .version;
  return {
    "firebase-admin": version("firebase-admin"),
    firebase: version("firebase"),
    "@firebase/auth": version("@firebase/auth"),
  };
}

/**
 * Fixtures that hold a harnessDigest and are not enrolled: the digest is not a hash of a lane's
 * sources plus data the way the enrolled ones are, so it cannot follow a comment rewrite. Their
 * `inputs` (repository paths) are guarded instead: a rewrite of any of them is refused, since it
 * would make the recorded digest stale without anything noticing. A fixture in neither list fails
 * the selftest.
 */
const SRC = (files) => files.map((file) => `conformance/src/${file}`);
const FEDERATION_REASON =
  "each recorded digest is a per-recording approval binding: a sha256 over the raw bytes of the modules record.mjs lists (SOURCES) as they were at that recording, named by an owner-ledger approval, and nothing compares it with today's sources. Freezing the listed inputs against a rewrite is a precaution, not a check";
const FEDERATION_INPUTS = SRC([
  "auth-federation/record.mjs",
  "auth-federation/run.mjs",
  "auth-federation/corpus.mjs",
  "auth-federation/corpus-saml.mjs",
  "auth-federation/corpus-followup.mjs",
  "auth-federation/guard.mjs",
  "auth-federation/harness.mjs",
  "auth-federation/idp.mjs",
  "auth-federation/hosting.mjs",
  "auth-federation/approval.mjs",
  "auth-federation/project-locks.mjs",
  "auth-federation/saml-smoke.mjs",
  "auth-federation/saml.mjs",
  "auth-account/harness.mjs",
]);
/** The two digests of the tenant-blocking runner (its `harnessDigest`), rebuilt from the tree. */
function tenantBlockingDigests() {
  const sources = [
    "auth-tenant-blocking/harness.mjs",
    "auth-tenant-blocking/session.mjs",
    "auth-mfa/harness.mjs",
    "auth-mfa/session.mjs",
    "auth-credential/session.mjs",
    "auth-credential/tokens.mjs",
    "auth-account/harness.mjs",
    "auth-account/session.mjs",
  ]
    .map((file) => treeReader(file))
    .join("\n");
  const head = `${sources}\n${JSON.stringify(BASELINE_CONFIG)}\n${JSON.stringify(AUTHORIZED_DOMAINS)}`;
  const fixture = ["index.js", "package.json", "package-lock.json", "firebase.json"]
    .map((file) => treeReader(`auth-tenant-blocking/function/${file}`))
    .join("\n");
  return { tenant: sha256(head), blocking: sha256(`${head}\n${fixture}`) };
}

export const WAIVED_FIXTURES = [
  {
    fixture: "fs-ent-text-production.json",
    reason:
      "the lexical program keeps the digest of the text lane's request layer (fs-ent-text/harness.mjs and session.mjs, sha256 of both joined by a newline and an empty index text), but the search-root OR refusal program was added from a separate single observation without a harness digest, so the fixture cannot be enrolled as one lane. The text closure replays its rows through pipeline_shape.rs and fs-ent-text-refusal-evidence.test.mjs, not through the lane runner; the listed inputs are guarded against a rewrite",
    inputs: SRC(["fs-ent-text/harness.mjs", "fs-ent-text/session.mjs"]),
  },
  ...[
    "auth-federation-followup-production.json",
    "auth-federation-production.json",
    "auth-federation-saml-production.json",
  ].map((fixture) => ({ fixture, reason: FEDERATION_REASON, inputs: FEDERATION_INPUTS })),
  {
    fixture: "auth-tenant-blocking-production.json",
    reason:
      "the runner keeps two digests (the tenant suite and the blocking suite, which adds the Functions fixture's files) and the blocking one reads files that are not sources. The listed inputs are guarded against a rewrite, and `recompute` rebuilds both digests so an ordinary commit that changes an input fails the selftest",
    recompute: () => tenantBlockingDigests(),
    inputs: [
      ...SRC([
        "auth-tenant-blocking/harness.mjs",
        "auth-tenant-blocking/session.mjs",
        "auth-mfa/harness.mjs",
        "auth-mfa/session.mjs",
        "auth-credential/session.mjs",
        "auth-credential/tokens.mjs",
        "auth-account/harness.mjs",
        "auth-account/session.mjs",
        "auth-account/corpus.mjs",
        "auth-tenant-blocking/run.mjs",
      ]),
      ...["index.js", "package.json", "package-lock.json", "firebase.json"].map(
        (file) => `conformance/src/auth-tenant-blocking/function/${file}`,
      ),
    ],
  },
];

/**
 * Enrolled lanes whose recorded digest no lineage connects to today's, with the digest they were
 * last seen at: a further change flips the entry, so it cannot hide a second drift.
 */
export const KNOWN_UNCONNECTED = {
  "auth-fs-cross-stage2": {
    currentScheme2: "259d8e746461e4d8c6ad755d131e6b7caed3ca3660005469c7758fb912b69cba",
    reason:
      "the stop-time cleanup of stage2-session.mjs changed after the rows were recorded (3a7777242); shared sdk-wire.mjs then changed local buffered-write callback acceptance for S5b admission (682afb4412), a branch enabled only by s5bAdmission; neither change is connected to the recorded stage-2 digest, and no hop is written until a stage-2 rerun is planned and the owner decides on it",
  },
};

// ---- digests ---------------------------------------------------------------------------------

/**
 * The tokens of a source as the parser reads them, without comments and whitespace, plus a `;` at
 * every place the parser inserted one (a line break that ends a statement is meaning: `return x`
 * and `return` newline `x` differ). The parser, not the tokenizer, decides what is a regular
 * expression and what is division, so nothing the engine runs can hide inside a "comment".
 * Source that does not parse throws.
 */
export function sourceTokens(text) {
  // A stable sort by position: an inserted `;` sits at the end of the token before it.
  return tokensInReportOrder(text)
    .toSorted((a, b) => a.at - b.at)
    .map((token) => token.text);
}

/** The tokens in the order the parser reported them, with their positions. */
export function tokensInReportOrder(text) {
  const found = [];
  parse(text, {
    ecmaVersion: "latest",
    sourceType: "module",
    onToken: (token) => {
      // The end-of-input marker is not source text.
      if (token.type.label !== "eof")
        found.push({ at: token.start, text: text.slice(token.start, token.end) });
    },
    onInsertedSemicolon: (at) => found.push({ at, text: ";" }),
  });
  return found;
}

const withFile = (file, run) => {
  try {
    return run();
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
};

/**
 * A lane's extra inputs: data, not code, as a string (a function when it reads data files, which
 * it reads through `readData`: this checkout's by default, a revision's when a hop is verified).
 */
const extraOf = (lane, readData) =>
  typeof lane.extra === "function" ? lane.extra(readData) : lane.extra;

/** The historical digest of a lane's inputs (see the header). */
export function rawDigest(lane, read, extra = extraOf(lane)) {
  const sources = lane.files.map((file) => read(file)).join("\n");
  return sha256(lane.noExtraTail ? sources : `${sources}\n${extra}`);
}

/** The digest of a lane's inputs as token streams, the extra inputs and the file names. */
export function scheme2Digest(lane, read, extra = extraOf(lane)) {
  for (const file of lane.files)
    if (!/\.m?js$/.test(file))
      throw new Error(`${file}: only .mjs and .js are digested as tokens; put data in extra`);
  const files = lane.files.map((file) => ({
    file,
    tokens: sha256(JSON.stringify(withFile(file, () => sourceTokens(read(file))))),
  }));
  return sha256(JSON.stringify({ scheme: 2, files, extra }));
}

/** Reads a harness source from this checkout. */
export const treeReader = (file) => readFileSync(join(CONFORMANCE_DIR, "src", file), "utf8");

/** Reads a harness source as it was at `commit`. */
export const gitReader = (commit) => (file) =>
  execFileSync("git", ["show", `${commit}:conformance/src/${file}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** Reads a data input (a path under conformance/) as it was at `commit`; a missing file throws. */
export const gitDataReader = (commit) => (path) =>
  execFileSync("git", ["show", `${commit}:conformance/${path}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

// ---- the acceptance rule -----------------------------------------------------------------------

/**
 * How a recorded digest relates to today's harness: `raw` and `scheme2` when it is today's digest,
 * `lineage` when a hop connects it, otherwise `stale`.
 */
export function checkFixtureDigest(name, lane, saved, { read = treeReader, lineage } = {}) {
  const hops = lineage ?? loadLineage().hops;
  const current = scheme2Digest(lane, read);
  if (saved === current) return { state: "scheme2", saved, current };
  if (saved === rawDigest(lane, read)) return { state: "raw", saved, current };
  const hop = hops.find((h) => h.lane === name && h.from === saved && h.to === current);
  return { state: hop ? "lineage" : "stale", saved, current };
}

/** Lanes whose fixture records one harness digest for the whole file instead of one per program. */
const WHOLE_FILE_DIGEST_LANES = new Set(["auth-fs-cross-stage2", "securetoken-body"]);

/** The harness digests a lane's fixture records (every row's, or the one of the whole file). */
export function recordedDigests(name, fixture) {
  const found = WHOLE_FILE_DIGEST_LANES.has(name)
    ? [fixture.harnessDigest]
    : Object.values(fixture.programs ?? {}).map((program) => program.harnessDigest);
  if (found.length === 0 || found.some((digest) => !/^[0-9a-f]{64}$/.test(digest ?? "")))
    throw new Error(`${name}: the fixture has a row without a harnessDigest`);
  return [...new Set(found)];
}

/** The state of one lane against its fixture: the worst state over its recorded digests. */
export function laneStatus(
  name,
  lane,
  {
    read = treeReader,
    lineage,
    fixture = JSON.parse(readFileSync(join(CONFORMANCE_DIR, lane.fixture), "utf8")),
  } = {},
) {
  const results = recordedDigests(name, fixture).map((saved) =>
    checkFixtureDigest(name, lane, saved, { read, lineage }),
  );
  return (
    results.find((r) => r.state === "stale") ??
    results.find((r) => r.state === "lineage") ??
    results[0]
  );
}

// ---- the lineage file ---------------------------------------------------------------------------

export const LINEAGE_PATH = join(CONFORMANCE_DIR, "harness-lineage.json");
const HOP_KEYS = ["commit", "from", "kind", "lane", "to"];
const UNREACHED_HOP_KEYS = [...HOP_KEYS, "condition", "fix"];
const HOP_KINDS = ["scheme", "unreached"];

/** The prefix of the transport error session.mjs records when a response body cannot be read. */
export const BODY_STAGE_PREFIX = "body:";

/** What the recorder writes for a step whose dependency recorded nothing (harness.mjs). */
const UNRESOLVED = /^step (\S+) recorded nothing at .+$/;
/** The keys of a recorded program; `steps` and `second` hold answers, the rest is provenance. */
const PROGRAM_KEYS = new Set([
  "corpusDigest",
  "harnessDigest",
  "recordedAt",
  "gitSha",
  "steps",
  "second",
]);
const ANSWER_SLOTS = ["steps", "second"];

/**
 * Why one recorded answer cannot be the result of a body-read failure: it has a numeric status
 * (its body was read, or its fetch failed and says so with a transport error) or a numeric gRPC
 * code. A status -1 row is a step whose dependency recorded nothing; it is accepted only with the
 * evidence the recorder writes for it (`unresolved` naming another step of the same slot, and the
 * `dependencyTransient` of that step), since a body failure never writes it.
 */
function answerProblem(stepId, row, slot) {
  const error = row?.transportError;
  if (typeof error === "string" && error.startsWith(BODY_STAGE_PREFIX))
    return `the body of the answer could not be read (${error})`;
  if (row?.status === -1) {
    const dependency = UNRESOLVED.exec(
      typeof row.unresolved === "string" ? row.unresolved : "",
    )?.[1];
    if (dependency === undefined || dependency === stepId || slot[dependency] === undefined)
      return "status -1 without the dependency evidence the recorder writes";
    if (row.dependencyTransient !== isTransient(slot[dependency]))
      return `status -1 whose dependencyTransient is not that of step ${dependency}`;
    return undefined;
  }
  if (row?.status === 0)
    return typeof error === "string" ? undefined : "status 0 without a transport error";
  if (typeof row?.status === "number" || typeof row?.code === "number") return undefined;
  return "neither a numeric status nor a numeric gRPC code";
}

/**
 * Why the rows of a FS-QUERY-INDEX fixture cannot have reached the body-read failure path of
 * session.mjs: every recorded answer, in every answer slot of every program (`steps` and
 * `second`), passes answerProblem, and a program has no other key than the known ones. An empty
 * fixture proves nothing and is refused.
 */
export function bodyReadStageProblems(fixture) {
  const problems = [];
  let answers = 0;
  for (const [programId, program] of Object.entries(fixture?.programs ?? {})) {
    for (const key of Object.keys(program ?? {}))
      if (!PROGRAM_KEYS.has(key)) problems.push(`${programId}: unexpected key ${key}`);
    for (const slotName of ANSWER_SLOTS)
      for (const [stepId, row] of Object.entries(program?.[slotName] ?? {})) {
        answers += 1;
        const problem = answerProblem(stepId, row, program[slotName]);
        if (problem)
          problems.push(
            `${programId}#${stepId}${slotName === "steps" ? "" : ` (${slotName})`}: ${problem}`,
          );
      }
  }
  if (answers === 0) problems.push("the fixture records no answer");
  return problems;
}

/**
 * The closed table of conditions an "unreached" hop may name. A condition is one approved change:
 * the commit it was made at (`fix`), the commit before it, where the recorded digests reproduce
 * (`base`), what it may change among a lane's inputs (`touches`) and the sha256 of its exact delta
 * over those paths (`deltaSha256`, from gitFixDelta). A hop naming any other fix, or a fix whose
 * change hashes differently, is refused; a different fix needs a new reviewed entry.
 * `problems(fixture)` is empty when the recorded rows show the changed path was not reached.
 */
export const UNREACHED_CONDITIONS = {
  "fs-query-index-body-read-unreached": {
    base: "e7b7a53a4fdf5eaa8206745f162da3c7bb81de8b",
    fix: "0c7a9ee5649cea2fdd4f108b704ae4ac3d760b75",
    deltaSha256: "6a43fe4af37970c41f62ece5a4a16100c58f1ede7d30491f4466b5d5b8a8caa8",
    touches: ["conformance/src/fs-query-index/session.mjs"],
    problems: bodyReadStageProblems,
  },
};

/**
 * What changed between two commits: every changed path, and the sha256 of the delta over `paths`,
 * which is each path's content at the base and at the fix (null where it does not exist). Blobs,
 * not diff text, so no git configuration can change the hash.
 */
export function gitFixDelta(base, fix, paths, cwd = REPO_ROOT) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const changed = git("diff-tree", "-r", "--name-only", "-z", base, fix)
    .split("\0")
    .filter(Boolean);
  const blob = (revision, path) => {
    try {
      return git("show", `${revision}:${path}`);
    } catch {
      return null;
    }
  };
  const delta = paths.map((path) => [path, blob(base, path), blob(fix, path)]);
  return { changed, deltaSha256: sha256(JSON.stringify(delta)) };
}

/** The current fixture of a lane. */
const treeFixture = (lane) => JSON.parse(readFileSync(join(CONFORMANCE_DIR, lane.fixture), "utf8"));

export function loadLineage(path = LINEAGE_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Everything wrong with the lineage: a malformed hop, a hop whose recorded digest does not
 * reproduce at its commit, whose scheme-2 digest is not that of its commit or of the current tree
 * (so the change between them is more than comments and whitespace), a commit that cannot be
 * read, and a shallow clone (history is needed, so this is a failure and never a skip).
 */
export function lineageProblems(
  lineage,
  {
    lanes,
    reader,
    shallow,
    current = treeReader,
    conditions = UNREACHED_CONDITIONS,
    fixDelta = gitFixDelta,
    dataReader = gitDataReader,
    fixtureOf = treeFixture,
  },
) {
  const problems = [];
  if (lineage?.version !== 1 || !Array.isArray(lineage.hops))
    return ["the lineage is not { version: 1, hops: [] }"];
  if (shallow && lineage.hops.length > 0)
    problems.push("this is a shallow clone: the lineage cannot be verified without the history");
  const seen = new Set();
  lineage.hops.forEach((hop, index) => {
    const at = `hop ${index}`;
    const before = problems.length;
    const allowedKeys = hop.kind === "unreached" ? UNREACHED_HOP_KEYS : HOP_KEYS;
    const extraKeys = Object.keys(hop).filter((key) => !allowedKeys.includes(key));
    if (extraKeys.length) problems.push(`${at}: unexpected ${extraKeys.join(", ")}`);
    const lane = lanes[hop.lane];
    if (!lane) return problems.push(`${at}: unknown lane ${hop.lane}`);
    if (!HOP_KINDS.includes(hop.kind))
      problems.push(`${at}: kind ${hop.kind} is not one of ${HOP_KINDS}`);
    if (!/^[0-9a-f]{40}$/.test(hop.commit ?? ""))
      problems.push(`${at}: commit is not a full 40-hex SHA`);
    for (const key of ["from", "to"])
      if (!/^[0-9a-f]{64}$/.test(hop[key] ?? ""))
        problems.push(`${at}: ${key} is not a 64-hex digest`);
    if (hop.kind === "unreached") {
      if (!/^[0-9a-f]{40}$/.test(hop.fix ?? ""))
        problems.push(`${at}: fix is not a full 40-hex SHA`);
      if (!Object.hasOwn(conditions, hop.condition ?? ""))
        problems.push(`${at}: condition ${hop.condition} is not in the closed table`);
    }
    const id = `${hop.lane}/${hop.from}`;
    if (seen.has(id)) problems.push(`${at}: duplicate hop for ${id}`);
    seen.add(id);
    if (problems.length > before || shallow) return;
    let atCommit;
    try {
      atCommit = inputsAt(lane, hop.commit, { reader, dataReader });
    } catch (error) {
      return problems.push(
        `${at}: the sources at ${hop.commit} are not readable (${error.message})`,
      );
    }
    if (rawDigest(lane, atCommit.read, atCommit.extra) !== hop.from)
      problems.push(`${at}: the recorded digest does not reproduce at ${hop.commit}`);
    if (scheme2Digest(lane, current) !== hop.to)
      problems.push(`${at}: the scheme-2 digest of the current tree is not the hop's`);
    if (hop.kind === "unreached")
      problems.push(
        ...unreachedProblems(at, hop, lane, {
          atCommit,
          reader,
          dataReader,
          condition: conditions[hop.condition],
          fixDelta,
          fixtureOf,
        }),
      );
    else if (scheme2Digest(lane, atCommit.read, atCommit.extra) !== hop.to)
      problems.push(`${at}: the scheme-2 digest at ${hop.commit} is not the hop's`);
  });
  return problems;
}

/**
 * Every input of a lane's digest as it was at `revision`: the sources and the data its `extra`
 * reads, each read at that revision. An input that is missing there throws.
 */
function inputsAt(lane, revision, { reader, dataReader }) {
  const read = reader(revision);
  const sources = new Map(lane.files.map((file) => [file, read(file)]));
  for (const [file, text] of sources)
    if (typeof text !== "string") throw new Error(`${file} is missing`);
  const extra = extraOf(lane, dataReader(revision));
  if (typeof extra !== "string") throw new Error("a data input is missing");
  return { read: (file) => sources.get(file), extra };
}

/** The inputs of a lane's digest as repository paths (sources, data it reads, its fixture). */
const laneInputPaths = (lane) => [
  ...lane.files.map((file) => `conformance/src/${file}`),
  ...(lane.guarded ?? []),
  `conformance/${lane.fixture}`,
];

/**
 * What is wrong with an "unreached" hop beyond the checks every hop shares (see the header): it
 * names the condition's approved fix commit; the change from the condition's base to that commit
 * hashes to the approved diff and touches exactly the inputs the condition names; the inputs at
 * the hop's commit differ from those at the base by comments and whitespace only; the scheme-2
 * digest at the fix commit is the hop's; and the condition holds for the lane's fixture.
 */
function unreachedProblems(
  at,
  hop,
  lane,
  { atCommit, reader, dataReader, condition, fixDelta, fixtureOf },
) {
  if (hop.fix !== condition.fix)
    return [`${at}: the fix commit ${hop.fix} is not the one the condition approves`];
  const problems = [];
  try {
    const delta = fixDelta(condition.base, condition.fix, condition.touches);
    const inputs = new Set(laneInputPaths(lane));
    const touched = delta.changed.filter((path) => inputs.has(path)).toSorted();
    const allowed = [...condition.touches].toSorted();
    if (touched.join("\n") !== allowed.join("\n"))
      problems.push(
        `${at}: the fix commit changes the inputs [${touched}], the condition allows exactly [${allowed}]`,
      );
    if (delta.deltaSha256 !== condition.deltaSha256)
      problems.push(`${at}: the change to ${condition.touches} is not the approved one`);
    const base = inputsAt(lane, condition.base, { reader, dataReader });
    if (
      scheme2Digest(lane, atCommit.read, atCommit.extra) !==
      scheme2Digest(lane, base.read, base.extra)
    )
      problems.push(`${at}: the inputs changed between ${hop.commit} and the base of the fix`);
    const fixed = inputsAt(lane, condition.fix, { reader, dataReader });
    if (scheme2Digest(lane, fixed.read, fixed.extra) !== hop.to)
      problems.push(`${at}: the scheme-2 digest at the fix commit is not the hop's`);
  } catch (error) {
    return [...problems, `${at}: the fix commit and its base are not readable (${error.message})`];
  }
  for (const problem of condition.problems(fixtureOf(lane)))
    problems.push(`${at}: condition ${hop.condition} fails: ${problem}`);
  return problems;
}

/**
 * The "unreached" hops a condition calls for: one for every distinct harness digest the fixtures
 * of the lanes that read the condition's file record and the lineage does not have yet, at the
 * condition's base (the recorded raw digest must reproduce there, from the inputs at the base).
 * The caller adds them to the lineage; lineageProblems then checks every part of them.
 */
export function proposeUnreachedHops({
  condition,
  lanes = HARNESS_LANES,
  lineage = loadLineage(),
  reader = gitReader,
  dataReader = gitDataReader,
  current = treeReader,
  conditions = UNREACHED_CONDITIONS,
  fixtureOf = treeFixture,
}) {
  if (!Object.hasOwn(conditions, condition))
    throw new Error(`condition ${condition} is not in the closed table`);
  const { base, fix, touches } = conditions[condition];
  const known = new Set(lineage.hops.map((hop) => `${hop.lane}/${hop.from}`));
  const hops = [];
  for (const [name, lane] of Object.entries(lanes)) {
    const inputs = laneInputPaths(lane);
    if (!touches.every((path) => inputs.includes(path))) continue;
    const atBase = inputsAt(lane, base, { reader, dataReader });
    for (const from of recordedDigests(name, fixtureOf(lane))) {
      if (known.has(`${name}/${from}`)) continue;
      if (rawDigest(lane, atBase.read, atBase.extra) !== from)
        throw new Error(`${name}: the recorded digest ${from} does not reproduce at ${base}`);
      hops.push({
        lane: name,
        from,
        to: scheme2Digest(lane, current),
        commit: base,
        kind: "unreached",
        fix,
        condition,
      });
    }
  }
  return hops;
}

// ---- enrollment --------------------------------------------------------------------------------

/** Every conformance fixture that holds a harnessDigest. */
export function fixturesWithHarnessDigest(dir = CONFORMANCE_DIR) {
  return readdirSync(dir)
    .filter((file) => file.endsWith("-production.json"))
    .filter((file) => /"harnessDigest"\s*:/.test(readFileSync(join(dir, file), "utf8")))
    .toSorted();
}

/** Fixtures neither enrolled nor waived, waivers without a reason, and entries for no fixture. */
export function enrollmentProblems({
  fixtures = fixturesWithHarnessDigest(),
  lanes = HARNESS_LANES,
  waived = WAIVED_FIXTURES,
} = {}) {
  const problems = [];
  const enrolled = new Set(Object.values(lanes).map((lane) => lane.fixture));
  const waivedNames = new Set(waived.map((w) => w.fixture));
  for (const fixture of fixtures)
    if (!enrolled.has(fixture) && !waivedNames.has(fixture))
      problems.push(`${fixture}: has a harnessDigest and is neither enrolled nor waived`);
  for (const { fixture, reason, inputs } of waived) {
    if (typeof reason !== "string" || reason.length < 20)
      problems.push(`${fixture}: the waiver needs a reason`);
    if (!Array.isArray(inputs) || inputs.length === 0)
      problems.push(`${fixture}: the waiver names no inputs to guard`);
    for (const input of inputs ?? [])
      if (!existsSync(join(REPO_ROOT, input)))
        problems.push(`${fixture}: the guarded input ${input} does not exist`);
    if (!fixtures.includes(fixture))
      problems.push(`${fixture}: waived, but no such fixture holds a harnessDigest`);
    if (enrolled.has(fixture)) problems.push(`${fixture}: both enrolled and waived`);
  }
  for (const fixture of enrolled)
    if (!fixtures.includes(fixture))
      problems.push(`${fixture}: enrolled, but no such fixture holds a harnessDigest`);
  return problems;
}

/** What is wrong with one enrolled lane's status: unconnected, or a known entry out of date. */
function unconnectedProblem(name, status, entry) {
  if (status.state === "stale") {
    if (!entry)
      return `${name}: the recorded digest ${status.saved} is not connected to ${status.current}`;
    if (entry.currentScheme2 !== status.current)
      return `${name}: the known-unconnected entry is out of date (now ${status.current})`;
    if (typeof entry.reason !== "string" || entry.reason.length < 20)
      return `${name}: the known-unconnected entry needs a reason`;
    return undefined;
  }
  return entry ? `${name} is connected; drop its known-unconnected entry` : undefined;
}

/**
 * Enrolled lanes whose recorded digest no hop connects to today's, except the ones listed in
 * KNOWN_UNCONNECTED at their present digest; and known entries that no longer apply.
 */
export function unconnectedProblems({
  lanes = HARNESS_LANES,
  known = KNOWN_UNCONNECTED,
  lineage,
  statuses,
} = {}) {
  const problems = Object.entries(lanes)
    .map(([name, lane]) =>
      unconnectedProblem(
        name,
        statuses?.[name] ?? laneStatus(name, lane, { lineage }),
        known[name],
      ),
    )
    .filter(Boolean);
  for (const name of Object.keys(known))
    if (!lanes[name]) problems.push(`${name}: known-unconnected, but no such lane`);
  return problems;
}

/**
 * A waived lane that can rebuild its digests must still match its fixture: an ordinary commit that
 * changes one of its inputs fails here, as it does for an enrolled lane.
 */
export function waivedDigestProblems({ waived = WAIVED_FIXTURES } = {}) {
  const problems = [];
  for (const { fixture, recompute } of waived) {
    if (!recompute) continue;
    const fixtureText = JSON.parse(readFileSync(join(CONFORMANCE_DIR, fixture), "utf8"));
    const current = new Set(Object.values(recompute()));
    for (const saved of recordedDigests(fixture, fixtureText))
      if (!current.has(saved))
        problems.push(
          `${fixture}: the recorded digest ${saved} is none of the digests its inputs give today`,
        );
  }
  return problems;
}

/** Whether this checkout has only part of the history (a hop cannot be verified then). */
export function isShallowCheckout({ cwd = REPO_ROOT } = {}) {
  return (
    execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd,
      encoding: "utf8",
    }).trim() === "true"
  );
}

/** Everything the release gate and the selftest refuse: a shallow clone counts. */
export function bindingProblems({
  reader = gitReader,
  shallow,
  unconnected = unconnectedProblems,
  waivedDigests = waivedDigestProblems,
  report,
} = {}) {
  const lineage = report ? undefined : loadLineage();
  return [
    ...(report?.lineageProblems ??
      lineageProblems(lineage, {
        lanes: HARNESS_LANES,
        reader,
        shallow: shallow ?? isShallowCheckout(),
      })),
    ...(report?.enrollmentProblems ?? enrollmentProblems()),
    ...waivedDigests(),
    ...unconnected(report ? { statuses: report.lanes } : { lineage: lineage.hops }),
  ];
}

// ---- rewrites ---------------------------------------------------------------------------------

const LINEAGE_REPO_PATH = "conformance/harness-lineage.json";
const inputPath = (file) => `conformance/src/${file}`;
const fixturePath = (lane) => `conformance/${lane.fixture}`;

/** The repository paths a rewrite must not change without the registry seeing it. */
export function registryPaths({ lanes = HARNESS_LANES, waived = WAIVED_FIXTURES } = {}) {
  return [
    ...new Set([
      LINEAGE_REPO_PATH,
      ...Object.values(lanes).flatMap((lane) => [
        ...lane.files.map(inputPath),
        ...(lane.guarded ?? []),
        fixturePath(lane),
      ]),
      ...waived.flatMap((w) => w.inputs),
    ]),
  ].toSorted();
}

/**
 * Paths whose digest the registry cannot follow through a rewrite: the data and constants an
 * enrolled lane's digest also reads (`guarded`), and every input of a waived lane. Any
 * change to one makes a recorded digest stale without anything noticing, so a rewrite of one is a
 * problem.
 */
export function frozenPaths({ lanes = HARNESS_LANES, waived = WAIVED_FIXTURES } = {}) {
  const frozen = new Map();
  for (const [name, lane] of Object.entries(lanes))
    for (const path of lane.guarded ?? [])
      frozen.set(path, `${name} (a data or constant input of its digest)`);
  for (const { fixture, inputs } of waived)
    for (const path of inputs) frozen.set(path, `${fixture} (a waived lane's digest input)`);
  return frozen;
}

/**
 * What a rewrite of files (`overrides`: repository path -> the new text, e.g. a rebind of commit
 * SHAs) does to each lane: its state before and after, the inputs it touches, and the problems: a
 * lane that was connected and no longer is, and a lineage the rewrite left unsound. A rewrite of
 * comments leaves the scheme-2 digest, and so the state, alone.
 */
export function rewriteReport(
  overrides,
  {
    lanes = HARNESS_LANES,
    waived = WAIVED_FIXTURES,
    known = KNOWN_UNCONNECTED,
    reader = gitReader,
    shallow = isShallowCheckout(),
    proposeCommit,
  } = {},
) {
  for (const [path, text] of Object.entries(overrides))
    if (typeof text !== "string") throw new Error(`${path}: the new text must be a string`);
  const changedLineage = LINEAGE_REPO_PATH in overrides;
  const lineage = changedLineage ? JSON.parse(overrides[LINEAGE_REPO_PATH]) : loadLineage();
  const beforeLineage = loadLineage();
  const read = (file) => overrides[inputPath(file)] ?? treeReader(file);
  const report = [];
  const problems = [];
  const proposed = [];
  for (const [path, why] of frozenPaths({ lanes, waived }))
    if (path in overrides)
      problems.push(`${path}: a rewrite changes an input the registry cannot follow: ${why}`);
  for (const [name, lane] of Object.entries(lanes)) {
    const before = laneStatus(name, lane, { lineage: beforeLineage.hops });
    const fixture =
      fixturePath(lane) in overrides ? JSON.parse(overrides[fixturePath(lane)]) : undefined;
    const after = laneStatus(name, lane, { read, lineage: lineage.hops, fixture });
    const changedInputs = lane.files.filter((file) => inputPath(file) in overrides);
    report.push({
      lane: name,
      changedInputs,
      fixtureChanged: fixture !== undefined,
      before: { state: before.state, current: before.current },
      after: { state: after.state, current: after.current },
      digestChanged: before.current !== after.current,
    });
    if (after.state === "stale" && before.state !== "stale") {
      problems.push(
        `${name}: the rewrite disconnects the recorded digest (was ${before.state}, now stale; scheme-2 ${before.current} -> ${after.current})`,
      );
      // Only comments and whitespace changed (the scheme-2 digest is the same) and the recorded
      // digest was today's raw one: a hop at the current commit connects it again. It is
      // proposed, never added: it goes in a commit of its own before the rewrite.
      if (before.state === "raw" && before.current === after.current && proposeCommit)
        proposed.push({
          lane: name,
          from: after.saved,
          to: after.current,
          commit: proposeCommit,
          kind: "scheme",
        });
    } else {
      // A lane that was unconnected before must still be the known one, at the same digest.
      const problem = unconnectedProblem(name, after, known[name]);
      if (problem) problems.push(`after the rewrite: ${problem}`);
    }
  }
  // A hop whose condition reads a fixture is checked again when that fixture is rewritten, even if
  // the lineage file is not.
  const changedConditionFixture = lineage.hops.some(
    (hop) =>
      hop.kind === "unreached" && lanes[hop.lane] && fixturePath(lanes[hop.lane]) in overrides,
  );
  if (changedLineage || changedConditionFixture)
    for (const problem of lineageProblems(lineage, {
      lanes,
      reader,
      shallow,
      current: (file) => overrides[inputPath(file)] ?? treeReader(file),
      fixtureOf: (lane) =>
        fixturePath(lane) in overrides
          ? JSON.parse(overrides[fixturePath(lane)])
          : treeFixture(lane),
    }))
      problems.push(`lineage after the rewrite: ${problem}`);
  return { lanes: report, problems, proposedHops: proposed };
}

// ---- report ------------------------------------------------------------------------------------

/** What `verify` prints: each lane's recorded and current digest and its state. */
export function verifyReport({ reader = gitReader, shallow } = {}) {
  const isShallow = shallow ?? isShallowCheckout();
  const lineage = loadLineage();
  const lanes = Object.fromEntries(
    Object.entries(HARNESS_LANES).map(([name, lane]) => {
      const status = laneStatus(name, lane, { lineage: lineage.hops });
      return [name, { ...status, known: KNOWN_UNCONNECTED[name] !== undefined }];
    }),
  );
  return {
    lanes,
    lineageProblems: lineageProblems(lineage, { lanes: HARNESS_LANES, reader, shallow: isShallow }),
    enrollmentProblems: enrollmentProblems(),
  };
}

/**
 * What `verify` prints and its exit code: the lanes, and the same problems the release gate and
 * the selftest refuse (an unconnected lane, a known entry out of date, an unsound hop, an
 * unlisted fixture, a shallow clone).
 */
export function verifyOutcome({
  json = false,
  report = verifyReport(),
  problems = bindingProblems(),
} = {}) {
  const lines = json
    ? [JSON.stringify(report, null, 2)]
    : Object.entries(report.lanes).map(
        ([name, lane]) =>
          `${name}: ${lane.state} (recorded ${lane.saved}, current ${lane.current})`,
      );
  return { lines, errors: problems, exitCode: problems.length ? 1 : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "paths") {
    console.log(JSON.stringify(registryPaths()));
  } else if (process.argv[2] === "rewrite-check") {
    // <overrides.json>: { "<repository path>": "<new text>" }; see rewriteReport.
    const head = process.argv[4] === "--head" ? process.argv[5] : undefined;
    const result = rewriteReport(JSON.parse(readFileSync(process.argv[3], "utf8")), {
      proposeCommit: head,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.problems.length) process.exitCode = 1;
  } else if (process.argv[2] === "unreached-hops") {
    // --condition <name> [--write]: the hops the condition calls for, checked as the lineage gate
    // checks them; with --write they are appended to harness-lineage.json.
    const option = (name) => process.argv[process.argv.indexOf(name) + 1];
    const lineage = loadLineage();
    const hops = proposeUnreachedHops({ condition: option("--condition"), lineage });
    const next = { ...lineage, hops: [...lineage.hops, ...hops] };
    const found = lineageProblems(next, {
      lanes: HARNESS_LANES,
      reader: gitReader,
      shallow: isShallowCheckout(),
    });
    for (const problem of found) console.error(problem);
    if (found.length) process.exitCode = 1;
    else if (process.argv.includes("--write"))
      writeFileSync(LINEAGE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    else console.log(JSON.stringify(hops, null, 2));
  } else if (process.argv[2] !== "verify") {
    console.error(
      "usage: harness-registry.mjs verify [--json] | paths | rewrite-check <overrides.json> [--head <sha>] | unreached-hops --condition <name> [--write]",
    );
    process.exitCode = 2;
  } else {
    const report = verifyReport();
    const outcome = verifyOutcome({
      json: process.argv.includes("--json"),
      report,
      problems: bindingProblems({ report }),
    });
    for (const line of outcome.lines) console.log(line);
    for (const problem of outcome.errors) console.error(problem);
    process.exitCode = outcome.exitCode;
  }
}
