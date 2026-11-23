import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CONFORMANCE_DIR, REPO_ROOT } from "./config.mjs";
import {
  BODY_STAGE_PREFIX,
  bodyReadStageProblems,
  checkFixtureDigest,
  checkVerifiedFixtureDigest,
  createLineageSnapshot,
  corpusOfLane,
  extraOf,
  gitDataReader,
  enrollmentProblems,
  frozenPaths,
  fixturesWithHarnessDigest,
  gitFixDelta,
  importClosure,
  gitReader,
  bindingProblems,
  HARNESS_LANES,
  isShallowCheckout,
  KNOWN_UNCONNECTED,
  laneStatus,
  lineageProblems,
  loadLineage,
  proposeUnreachedHops,
  rawDigest,
  recordedDigests,
  releaseLineageProblems,
  registryPaths,
  rewriteReport,
  scheme2Digest,
  sourceTokens,
  tokensInReportOrder,
  treeReader,
  unconnectedProblems,
  UNREACHED_CONDITIONS,
  verifyOutcome,
  waivedDigestProblems,
  WAIVED_FIXTURES,
} from "./harness-registry.mjs";

const digestOf = (text) => scheme2Digest({ files: ["a.mjs"], extra: "" }, () => text);

test("a comment or whitespace edit leaves the scheme-2 digest alone", () => {
  const base = "const a = 1;\nfunction f(x) { return x + a; }\n";
  const edited =
    "// provenance: commit 1111\n/** doc */\nconst   a = 1; // trailing\n\n\nfunction f(x) {\n  /* why */ return x +\n  a;\n}\n";
  assert.equal(digestOf(edited), digestOf(base));
});

test("any token edit changes the digest", () => {
  const base = "const a = 1;\nfunction f(x) { return x + a; }\n";
  for (const changed of [
    "const b = 1;\nfunction f(x) { return x + b; }\n",
    "const a = 2;\nfunction f(x) { return x + a; }\n",
    "const a = 1;\nfunction f(x) { return x - a; }\n",
    "const a = 1;\nfunction f(x) { return x + a; }\nf(1);\n",
    'const a = "1";\nfunction f(x) { return x + a; }\n',
  ])
    assert.notEqual(digestOf(changed), digestOf(base), changed);
});

test("an inserted semicolon and an explicit one are the same token", () => {
  const explicit = "const a = 1;\nfunction f(x) { return x + a; }\n";
  assert.equal(digestOf("const a = 1\nfunction f(x) { return x + a }\n"), digestOf(explicit));
});

// A line break that ends a statement is meaning, and the parser (not a tokenizer) decides what is
// a regular expression, so these pairs differ although their token texts and spacing do not.
const ASI_PAIRS = [
  ["return x", "return\n x"],
  ["a\n++b", "a++\nb"],
  ["async function f(){}", "async\nfunction f(){}"],
  ["function* g(){ yield x }", "function* g(){ yield\n x }"],
  ["l: for(;;){ continue l }", "l: for(;;){ continue\n l }"],
  ["l: for(;;){ break l }", "l: for(;;){ break\n l }"],
];

const wrapAsi = (body) => (/^(return|a)/.test(body) ? `function f(){ ${body}; }` : body);

test("a line break the parser turns into a statement end changes the digest", () => {
  for (const [joined, split] of ASI_PAIRS)
    assert.notEqual(digestOf(wrapAsi(joined)), digestOf(wrapAsi(split)), `${joined} / ${split}`);
});

test("code a tokenizer would read as a comment is still digested", () => {
  const withStatement = "export default function(){}\n/[/*]/.test(''); X = 1; //*/\n";
  const withoutStatement = "export default function(){}\n/[/*]/.test('');\n";
  assert.notEqual(digestOf(withStatement), digestOf(withoutStatement));
  const inAsync = "async function g(s){ await /[/*]/.exec(s); X = 1; //*/\n}\n";
  assert.notEqual(digestOf(inAsync), digestOf("async function g(s){ await /[/*]/.exec(s); }\n"));
  assert.ok(sourceTokens(withStatement).includes("X"));
});

test("the quote style of a string is part of the token", () => {
  assert.notEqual(digestOf("const a = 'x';"), digestOf('const a = "x";'));
});

test("comment-looking text inside strings, templates and regular expressions counts", () => {
  assert.notEqual(digestOf('const a = "// one";'), digestOf('const a = "// two";'));
  assert.notEqual(digestOf("const a = `/* one */`;"), digestOf("const a = `/* two */`;"));
  assert.notEqual(digestOf("const r = /\\/\\* one/;"), digestOf("const r = /\\/\\* two/;"));
  assert.notEqual(digestOf("const a = `x ${ /* c */ b } y`;"), digestOf("const a = `x ${ c } y`;"));
  assert.equal(
    digestOf("const a = `x ${ /* c */ b } y`;"),
    digestOf("const a = `x ${\n  b // c\n} y`;"),
  );
});

test("a slash is a division or a regular expression by context", () => {
  assert.deepEqual(
    sourceTokens("a = b / c / d;").filter((t) => t === "/"),
    ["/", "/"],
  );
  assert.ok(sourceTokens("a = /b\\/c/g.test(d);").includes("/b\\/c/g"));
});

test("a token boundary is never ambiguous and a file boundary matters", () => {
  assert.notEqual(digestOf("ab; c;"), digestOf("a; bc;"));
  const two = (a, b) =>
    scheme2Digest({ files: ["a.mjs", "b.mjs"], extra: "" }, (f) => (f === "a.mjs" ? a : b));
  assert.notEqual(two("x; y;", "z;"), two("x;", "y; z;"));
});

test("the extra inputs and the file names are bound", () => {
  const read = () => "const a = 1;";
  assert.notEqual(
    scheme2Digest({ files: ["a.mjs"], extra: "1" }, read),
    scheme2Digest({ files: ["a.mjs"], extra: "2" }, read),
  );
  assert.notEqual(
    scheme2Digest({ files: ["a.mjs"], extra: "" }, read),
    scheme2Digest({ files: ["b.mjs"], extra: "" }, read),
  );
});

test("source that does not parse is refused, never digested", () => {
  assert.throws(() => digestOf("a b"), /a\.mjs/);
  assert.throws(() => digestOf("const = 1;"), /a\.mjs/);
  assert.throws(() => digestOf('const a = "unterminated;'), /a\.mjs/);
  assert.throws(() => digestOf("const a = `unterminated;"), /a\.mjs/);
});

test("the raw digest is the historical one: the sources joined by a newline, then the extra", () => {
  const lane = { files: ["a.mjs", "b.mjs"], extra: '{"p":1}' };
  const reader = (f) => (f === "a.mjs" ? "A" : "B");
  const expected = createHash("sha256").update('A\nB\n{"p":1}').digest("hex");
  assert.equal(rawDigest(lane, reader), expected);
  assert.notEqual(rawDigest(lane, reader), rawDigest({ ...lane, extra: "x" }, reader));
});

// ---- the acceptance rule ------------------------------------------------------------------

const LANE = { files: ["a.mjs"], extra: "" };
const TREE = { "a.mjs": "// note\nconst a = 1;\n" };
const readTree = (f) => TREE[f];

test("a fixture digest is accepted when it is the raw or the scheme-2 digest of the tree", () => {
  const raw = rawDigest(LANE, readTree);
  const s2 = scheme2Digest(LANE, readTree);
  assert.equal(checkFixtureDigest("lane", LANE, raw, { read: readTree, lineage: [] }).state, "raw");
  assert.equal(
    checkFixtureDigest("lane", LANE, s2, { read: readTree, lineage: [] }).state,
    "scheme2",
  );
  const other = checkFixtureDigest("lane", LANE, "0".repeat(64), { read: readTree, lineage: [] });
  assert.equal(other.state, "stale");
});

test("a hop connects a recorded digest to the current scheme-2 digest, for its lane only", () => {
  const recorded = "1".repeat(64);
  const s2 = scheme2Digest(LANE, readTree);
  const hop = { lane: "lane", from: recorded, to: s2, commit: "c".repeat(40), kind: "scheme" };
  assert.equal(
    checkFixtureDigest("lane", LANE, recorded, { read: readTree, lineage: [hop] }).state,
    "lineage",
  );
  assert.equal(
    checkFixtureDigest("other", LANE, recorded, { read: readTree, lineage: [hop] }).state,
    "stale",
  );
  assert.equal(
    checkFixtureDigest("lane", LANE, recorded, {
      read: readTree,
      lineage: [{ ...hop, to: "2".repeat(64) }],
    }).state,
    "stale",
  );
  assert.equal(
    checkFixtureDigest("lane", LANE, "3".repeat(64), { read: readTree, lineage: [hop] }).state,
    "stale",
  );
});

// ---- the lineage file ---------------------------------------------------------------------

const COMMIT_OLD = "a".repeat(40);
const COMMIT_NEW = "b".repeat(40);
const OLD_TEXT = "// provenance 1111\nconst a = 1;\n";
const NEW_TEXT = "// provenance 2222\nconst a = 1;\n";
const files = { [COMMIT_OLD]: { "a.mjs": OLD_TEXT }, [COMMIT_NEW]: { "a.mjs": NEW_TEXT } };
const reader = (commit) => (file) => files[commit]?.[file];
const goodHop = () => ({
  lane: "lane",
  from: rawDigest(LANE, reader(COMMIT_OLD)),
  to: scheme2Digest(LANE, reader(COMMIT_OLD)),
  commit: COMMIT_OLD,
  kind: "scheme",
});
const problems = (hops, lanes = { lane: LANE }) =>
  lineageProblems(
    { version: 1, hops },
    { lanes, reader, shallow: false, current: reader(COMMIT_NEW) },
  );

test("a hop whose recorded digest reproduces at its commit and whose tokens match is sound", () => {
  assert.deepEqual(problems([goodHop()]), []);
});

test("a lineage hop checks the same historical bytes for readability and both digests", () => {
  const reads = [];
  const result = lineageProblems(
    { version: 1, hops: [goodHop()] },
    {
      lanes: { lane: LANE },
      reader: (commit) => (file) => {
        reads.push([commit, file]);
        return reader(commit)(file);
      },
      shallow: false,
      current: readTree,
    },
  );
  assert.deepEqual(result, []);
  assert.deepEqual(reads, [[COMMIT_OLD, "a.mjs"]]);
});

test("a hop that misreproduces its recorded digest or its scheme-2 digest is refused", () => {
  assert.match(problems([{ ...goodHop(), from: "9".repeat(64) }]).join("\n"), /recorded digest/);
  assert.match(problems([{ ...goodHop(), to: "9".repeat(64) }]).join("\n"), /scheme-2/);
});

test("the tokens must equal the tokens of the current tree (comments and whitespace only)", () => {
  // The hop was made at COMMIT_OLD; the current tree differs by a token, so `to` no longer holds.
  const changed = { ...files, [COMMIT_OLD]: { "a.mjs": "const a = 2;\n" } };
  const hop = {
    ...goodHop(),
    from: rawDigest(LANE, (f) => changed[COMMIT_OLD][f]),
    to: scheme2Digest(LANE, (f) => changed[COMMIT_OLD][f]),
  };
  const found = lineageProblems(
    { version: 1, hops: [hop] },
    {
      lanes: { lane: LANE },
      reader: (c) => (f) => (c === COMMIT_OLD ? changed[c][f] : readTree(f)),
      shallow: false,
      current: readTree,
    },
  );
  assert.match(found.join("\n"), /current tree/);
});

test("unknown lanes, kinds, malformed hops and duplicates are refused", () => {
  assert.match(problems([{ ...goodHop(), lane: "nope" }]).join("\n"), /unknown lane/);
  assert.match(problems([{ ...goodHop(), kind: "reviewed-non-row" }]).join("\n"), /kind/);
  assert.match(problems([{ ...goodHop(), commit: "abc" }]).join("\n"), /40-hex/);
  assert.match(problems([{ ...goodHop(), from: "xyz" }]).join("\n"), /64-hex/);
  assert.match(problems([goodHop(), goodHop()]).join("\n"), /duplicate/);
  assert.match(problems([{ ...goodHop(), extra: 1 }]).join("\n"), /unexpected/);
});

test("a commit that is not in the history is refused; a shallow clone is a hard failure", () => {
  const missing = () => () => {
    throw new Error("bad object");
  };
  assert.match(
    lineageProblems(
      { version: 1, hops: [goodHop()] },
      { lanes: { lane: LANE }, reader: missing, shallow: false, current: readTree },
    ).join("\n"),
    /not readable/,
  );
  assert.match(
    lineageProblems(
      { version: 1, hops: [goodHop()] },
      { lanes: { lane: LANE }, reader, shallow: true, current: readTree },
    ).join("\n"),
    /shallow/,
  );
});

// ---- the checked-in registry --------------------------------------------------------------

test("every fixture with a harnessDigest is enrolled or waived with a reason", () => {
  assert.deepEqual(enrollmentProblems(), []);
});

test("enrollment problems name an unlisted fixture, a waiver without a reason, and a stale entry", () => {
  const found = enrollmentProblems({
    fixtures: ["a-production.json", "b-production.json", "c-production.json"],
    lanes: { a: { fixture: "a-production.json" } },
    waived: [
      { fixture: "b-production.json", reason: "" },
      { fixture: "gone-production.json", reason: "a real reason here" },
    ],
  });
  assert.match(found.join("\n"), /c-production\.json.*neither enrolled nor waived/);
  assert.match(found.join("\n"), /b-production\.json.*reason/);
  assert.match(found.join("\n"), /gone-production\.json.*no such fixture/);
  assert.ok(!found.join("\n").includes("a-production.json"));
});

test("a fixture that is both enrolled and waived is refused", () => {
  const found = enrollmentProblems({
    fixtures: ["a-production.json"],
    lanes: { a: { fixture: "a-production.json" } },
    waived: [{ fixture: "a-production.json", reason: "a real reason here" }],
  });
  assert.match(found.join("\n"), /both enrolled and waived/);
});

test("the checked-in lineage is sound against the git history", () => {
  const lineage = loadLineage();
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const required = process.env.FIREEMU_REQUIRE_FULL_HISTORY === "1";
  assert.ok(shallow === "false" || !required, "the release job needs the full history");
  assert.deepEqual(
    lineageProblems(lineage, {
      lanes: HARNESS_LANES,
      reader: gitReader,
      shallow: shallow === "true",
    }),
    [],
  );
});

test("every enrolled lane is current, or listed as known unconnected at its present digest", () => {
  assert.deepEqual(unconnectedProblems(), []);
});

test("an unconnected lane, a stale known entry and an unneeded one are each a problem", () => {
  const name = "auth-fs-cross-stage2";
  const lanes = { [name]: HARNESS_LANES[name] };
  assert.match(unconnectedProblems({ lanes, known: {} }).join("\n"), /not connected/);
  assert.match(
    unconnectedProblems({
      lanes,
      known: { [name]: { ...KNOWN_UNCONNECTED[name], currentScheme2: "0" } },
    }).join("\n"),
    /out of date/,
  );
  assert.match(
    unconnectedProblems({
      lanes,
      known: { [name]: { ...KNOWN_UNCONNECTED[name], reason: "short" } },
    }).join("\n"),
    /needs a reason/,
  );
  assert.match(
    unconnectedProblems({
      lanes: { "fs-rules": HARNESS_LANES["fs-rules"] },
      known: { "fs-rules": KNOWN_UNCONNECTED[name] },
    }).join("\n"),
    /is connected/,
  );
  assert.match(
    unconnectedProblems({
      lanes,
      known: { ...KNOWN_UNCONNECTED, nope: KNOWN_UNCONNECTED[name] },
    }).join("\n"),
    /no such lane/,
  );
});

test("the release gate's binding check is clean here and refuses a shallow clone", () => {
  assert.deepEqual(bindingProblems({ shallow: false }), []);
  assert.match(bindingProblems({ shallow: true }).join("\n"), /shallow clone/);
});

test("the enrolled lane definitions cover exactly the files their runners digest", () => {
  for (const lane of Object.values(HARNESS_LANES))
    for (const file of lane.files)
      assert.ok(existsSync(join(CONFORMANCE_DIR, "src", file)), `${file} exists`);
  const fixtures = readdirSync(CONFORMANCE_DIR).filter((f) => f.endsWith("-production.json"));
  for (const lane of Object.values(HARNESS_LANES)) assert.ok(fixtures.includes(lane.fixture));
  assert.ok(WAIVED_FIXTURES.every((w) => fixtures.includes(w.fixture)));
  assert.ok(readFileSync(join(CONFORMANCE_DIR, "harness-lineage.json"), "utf8").length > 0);
});

test("each lane's runner digests exactly the files the registry lists", async () => {
  const { harnessDigest: fsRules } = await import("./fs-rules/run.mjs");
  const { harnessDigest: stage1 } = await import("./auth-fs-cross/run.mjs");
  const { stage2HarnessDigest } = await import("./auth-fs-cross/stage2-record.mjs");
  assert.equal(await fsRules(), rawDigest(HARNESS_LANES["fs-rules"], treeReader));
  assert.equal(await stage1(), rawDigest(HARNESS_LANES["auth-fs-cross"], treeReader));
  assert.equal(
    await stage2HarnessDigest(),
    rawDigest(HARNESS_LANES["auth-fs-cross-stage2"], treeReader),
  );
});

// ---- more of the rule -------------------------------------------------------------------

test("a lane's status is the worst of its recorded digests", () => {
  const raw = rawDigest(LANE, readTree);
  const s2 = scheme2Digest(LANE, readTree);
  const recorded = "1".repeat(64);
  const hop = { lane: "lane", from: recorded, to: s2, commit: "c".repeat(40), kind: "scheme" };
  const status = (digests) =>
    laneStatus(
      "lane",
      { ...LANE, fixture: "x" },
      {
        read: readTree,
        lineage: [hop],
        fixture: {
          programs: Object.fromEntries(digests.map((d, i) => [`p${i}`, { harnessDigest: d }])),
        },
      },
    );
  assert.equal(status([raw, "9".repeat(64)]).state, "stale");
  assert.equal(status(["9".repeat(64), raw]).state, "stale");
  assert.equal(status([raw, recorded]).state, "lineage");
  assert.equal(status([recorded, raw]).state, "lineage");
  assert.equal(status([raw, s2]).state, "raw");
  assert.equal(status([s2, raw]).state, "scheme2");
  assert.equal(status([raw, raw]).state, "raw");
});

test("a fixture row without a harnessDigest is an error, not a pass", () => {
  assert.throws(() => recordedDigests("lane", { programs: { a: {} } }), /without a harnessDigest/);
  assert.throws(() => recordedDigests("lane", { programs: {} }), /without a harnessDigest/);
  assert.throws(
    () => recordedDigests("lane", { programs: { a: { harnessDigest: "abc" } } }),
    /without/,
  );
  assert.throws(() => recordedDigests("auth-fs-cross-stage2", {}), /without a harnessDigest/);
  assert.deepEqual(recordedDigests("auth-fs-cross-stage2", { harnessDigest: "a".repeat(64) }), [
    "a".repeat(64),
  ]);
  const same = { harnessDigest: "b".repeat(64) };
  assert.deepEqual(recordedDigests("lane", { programs: { a: same, b: same } }), ["b".repeat(64)]);
});

test("a commit that is not a full lowercase SHA is refused", () => {
  for (const commit of ["abc1234", "a".repeat(39), "a".repeat(41), "A".repeat(40)])
    assert.match(problems([{ ...goodHop(), commit }]).join("\n"), /40-hex/, commit);
});

test("a digest that is not 64 lowercase hex is refused, in either field", () => {
  for (const key of ["from", "to"])
    for (const value of ["abc", "9".repeat(63), "9".repeat(65), "F".repeat(64)])
      assert.match(
        problems([{ ...goodHop(), [key]: value }]).join("\n"),
        /64-hex/,
        `${key} ${value}`,
      );
});

test("the scheme-2 digest of a hop's commit is checked apart from the current tree's", () => {
  // The recorded digest reproduces at the commit and `to` is today's, but the commit's tokens
  // differ from today's: more than comments changed, and the hop must not stand.
  const commitText = { "a.mjs": "const a = 2;\n" };
  const hop = {
    ...goodHop(),
    from: rawDigest(LANE, (f) => commitText[f]),
    to: scheme2Digest(LANE, readTree),
  };
  const found = lineageProblems(
    { version: 1, hops: [hop] },
    {
      lanes: { lane: LANE },
      reader: () => (f) => commitText[f],
      shallow: false,
      current: readTree,
    },
  );
  assert.equal(found.length, 1);
  assert.match(found[0], /scheme-2 digest at/);
});

test("one bad hop does not hide the next", () => {
  const found = problems([
    { ...goodHop(), extra: 1 },
    { ...goodHop(), from: "9".repeat(64) },
  ]);
  assert.match(found.join("\n"), /unexpected/);
  assert.match(found.join("\n"), /recorded digest does not reproduce/);
});

test("a waiver needs a reason of substance", () => {
  const found = enrollmentProblems({
    fixtures: ["a-production.json"],
    lanes: {},
    waived: [{ fixture: "a-production.json", reason: "short" }],
  });
  assert.match(found.join("\n"), /needs a reason/);
});

test("fixture discovery lists only *-production.json files that hold a harnessDigest", () => {
  const dir = mkdtempSync(join(tmpdir(), "registry-"));
  try {
    writeFileSync(
      join(dir, "a-production.json"),
      '{ "programs": { "p": { "harnessDigest": "x" } } }',
    );
    writeFileSync(join(dir, "b-production.json"), '{ "programs": {} }');
    writeFileSync(join(dir, "c.json"), '{ "harnessDigest": "x" }');
    writeFileSync(join(dir, "d-production.json"), '{"harnessDigest":"x"}');
    assert.deepEqual(fixturesWithHarnessDigest(dir), ["a-production.json", "d-production.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- rewrites (the rebind guard) ----------------------------------------------------------

const readSrc = (file) => readFileSync(join(CONFORMANCE_DIR, "src", file), "utf8");
const laneReport = (report, name) => report.lanes.find((l) => l.lane === name);
const NO_GIT = {
  reader: () => () => {
    throw new Error("no history in this test");
  },
  shallow: false,
};

test("the registry lists every input, fixture and the lineage a rewrite must show it", () => {
  const paths = registryPaths();
  assert.ok(paths.includes("conformance/harness-lineage.json"));
  assert.ok(paths.includes("conformance/src/auth-fs-cross/session.mjs"));
  assert.ok(paths.includes("conformance/src/auth-fs-cross/stage2-orchestrator.mjs"));
  assert.ok(paths.includes("conformance/fs-rules-production.json"));
  assert.deepEqual(paths, [...new Set(paths)].toSorted());
  assert.ok(!paths.includes("conformance/src/auth-fs-cross/run.mjs"), "a runner is not an input");
});

test("a rewrite of provenance comments leaves every lane as it was", () => {
  const file = "auth-fs-cross/session.mjs";
  const edited = readSrc(file).replace(
    /^\/\/ Copied from.*$/m,
    "// Copied from elsewhere, at commit 0000",
  );
  assert.notEqual(edited, readSrc(file));
  const report = rewriteReport({ [`conformance/src/${file}`]: edited }, NO_GIT);
  assert.deepEqual(report.problems, []);
  const lane = laneReport(report, "auth-fs-cross");
  assert.deepEqual(lane.changedInputs, [file]);
  assert.equal(lane.digestChanged, false);
  assert.equal(lane.after.state, lane.before.state);
  assert.equal(laneReport(report, "fs-rules").changedInputs.length, 0);
});

test("a comment-only rewrite that disconnects a raw recorded digest proposes the hop, and adds none", () => {
  const file = "fs-rules/session.mjs";
  const edited = readSrc(file).replace(/^\/\/ Executes.*$/m, "// Executes programs, reworded");
  assert.notEqual(edited, readSrc(file));
  const head = "d".repeat(40);
  const report = rewriteReport(
    { [`conformance/src/${file}`]: edited },
    { ...NO_GIT, proposeCommit: head },
  );
  assert.match(report.problems.join("\n"), /fs-rules: the rewrite disconnects/);
  const lane = laneReport(report, "fs-rules");
  assert.equal(lane.digestChanged, false);
  assert.deepEqual(report.proposedHops, [
    {
      lane: "fs-rules",
      from: laneStatus("fs-rules", HARNESS_LANES["fs-rules"]).saved,
      to: lane.after.current,
      commit: head,
      kind: "scheme",
    },
  ]);
  // Without a commit to name, nothing is proposed; with a token change, nothing is either.
  assert.deepEqual(rewriteReport({ [`conformance/src/${file}`]: edited }, NO_GIT).proposedHops, []);
  const tokenChange = rewriteReport(
    { [`conformance/src/${file}`]: `${readSrc(file)}\nconst x = 1;\n` },
    { ...NO_GIT, proposeCommit: head },
  );
  assert.deepEqual(tokenChange.proposedHops, []);
  assert.match(tokenChange.problems.join("\n"), /fs-rules/);
});

test("a rewrite that changes a token of an input a lane is connected through is refused", () => {
  const file = "fs-rules/session.mjs";
  const edited = `${readSrc(file)}\nconst rewrittenByMistake = 1;\n`;
  const report = rewriteReport({ [`conformance/src/${file}`]: edited }, NO_GIT);
  const lane = laneReport(report, "fs-rules");
  assert.equal(lane.digestChanged, true);
  assert.equal(lane.after.state, "stale");
  assert.match(report.problems.join("\n"), /fs-rules: the rewrite disconnects/);
  // The same file is an input of the AUTH-FS-CROSS copy only through its own session; the lane
  // whose inputs the edit does not touch is left alone.
  assert.ok(!report.problems.join("\n").includes("auth-fs-cross:"));
});

test("a lane that is known unconnected stays so under a comment rewrite, and is refused under a token change", () => {
  const file = "auth-fs-cross/stage2-session.mjs";
  const comment = rewriteReport(
    { [`conformance/src/${file}`]: `// a comment\n${readSrc(file)}` },
    NO_GIT,
  );
  assert.equal(laneReport(comment, "auth-fs-cross-stage2").before.state, "stale");
  assert.deepEqual(comment.problems, []);
  const token = rewriteReport(
    { [`conformance/src/${file}`]: `${readSrc(file)}\nconst x = 1;\n` },
    NO_GIT,
  );
  assert.match(
    token.problems.join("\n"),
    /after the rewrite: auth-fs-cross-stage2: the known-unconnected entry is out of date/,
  );
});

test("a rewrite of a line break in the real stage-1 session is caught", () => {
  const file = "auth-fs-cross/session.mjs";
  const text = readSrc(file);
  assert.ok(text.includes("return id;"));
  const edited = text.replace("return id;", "return\n id;");
  const report = rewriteReport({ [`conformance/src/${file}`]: edited }, NO_GIT);
  assert.equal(laneReport(report, "auth-fs-cross").after.state, "stale");
  assert.match(report.problems.join("\n"), /auth-fs-cross: the rewrite disconnects/);
});

test("a rewrite of the fixture or of the lineage that disconnects a lane is refused", () => {
  const fixturePath = "conformance/auth-fs-cross-production.json";
  const fixture = JSON.parse(readFileSync(join(REPO_ROOT, fixturePath), "utf8"));
  for (const program of Object.values(fixture.programs)) program.harnessDigest = "7".repeat(64);
  const changedFixture = rewriteReport({ [fixturePath]: JSON.stringify(fixture) }, NO_GIT);
  assert.equal(laneReport(changedFixture, "auth-fs-cross").fixtureChanged, true);
  assert.match(changedFixture.problems.join("\n"), /auth-fs-cross: the rewrite disconnects/);
  const noHops = rewriteReport(
    { "conformance/harness-lineage.json": JSON.stringify({ version: 1, hops: [] }) },
    NO_GIT,
  );
  assert.match(noHops.problems.join("\n"), /auth-fs-cross: the rewrite disconnects/);
});

test("a rewritten lineage is verified as well, and a bad text is an error", () => {
  const hop = loadLineage().hops[0];
  const moved = JSON.stringify({ version: 1, hops: [{ ...hop, commit: "1".repeat(40) }] });
  const report = rewriteReport({ "conformance/harness-lineage.json": moved }, NO_GIT);
  assert.match(report.problems.join("\n"), /lineage after the rewrite: hop 0: the sources at/);
  assert.throws(() => rewriteReport({ "conformance/harness-lineage.json": "not json" }, NO_GIT));
  assert.throws(() => rewriteReport({ "conformance/src/x.mjs": 5 }, NO_GIT), /must be a string/);
});

test("a rewrite of a file no lane reads changes nothing", () => {
  const report = rewriteReport(
    { "conformance/src/auth-fs-cross/run.mjs": "// anything\n" },
    NO_GIT,
  );
  assert.deepEqual(report.problems, []);
  assert.ok(report.lanes.every((l) => l.changedInputs.length === 0 && !l.fixtureChanged));
});

test("a hop is never proposed for a lane that was connected through a hop", () => {
  const noHops = rewriteReport(
    { "conformance/harness-lineage.json": JSON.stringify({ version: 1, hops: [] }) },
    { ...NO_GIT, proposeCommit: "d".repeat(40) },
  );
  assert.match(noHops.problems.join("\n"), /auth-fs-cross: the rewrite disconnects/);
  assert.deepEqual(noHops.proposedHops, []);
});

test("a rewritten lineage is checked against the rewritten inputs", () => {
  const file = "auth-fs-cross/session.mjs";
  const report = rewriteReport(
    {
      "conformance/harness-lineage.json": JSON.stringify(loadLineage()),
      [`conformance/src/${file}`]: `${readSrc(file)}\nconst x = 1;\n`,
    },
    { reader: gitReader, shallow: false },
  );
  assert.match(
    report.problems.join("\n"),
    /lineage after the rewrite: hop 0: the scheme-2 digest of the current tree/,
  );
});

// ---- digest inputs the registry lists (review round 1) -------------------------------------

test("scheme 2 digests only JavaScript; data goes through extra", () => {
  const read = () => "{}";
  for (const file of ["a.json", "a.py", "a", "a.mjs.txt", "a.cjs"])
    assert.throws(
      () => scheme2Digest({ files: [file], extra: "" }, read),
      /only \.mjs and \.js/,
      file,
    );
  assert.doesNotThrow(() => scheme2Digest({ files: ["a.js"], extra: "" }, () => "a;"));
});

test("the waived fixtures are exactly these, so a new waiver is a visible edit here", () => {
  // Discovery sees only top-level `*-production.json` files that hold the key `"harnessDigest"`:
  // a fixture named otherwise, in a subdirectory or under another key is not found, so a new lane
  // must follow that convention.
  assert.deepEqual(WAIVED_FIXTURES.map((w) => w.fixture).toSorted(), [
    "auth-federation-followup-production.json",
    "auth-federation-production.json",
    "auth-federation-saml-production.json",
    "auth-tenant-blocking-production.json",
    "fs-ent-text-production.json",
  ]);
  assert.deepEqual(Object.keys(HARNESS_LANES).toSorted(), [
    "auth-account",
    "auth-action",
    "auth-config-sdk",
    "auth-credential",
    "auth-fs-cross",
    "auth-fs-cross-stage2",
    "auth-mfa",
    "fs-config-lifecycle",
    "fs-data-write-list",
    "fs-ent-pipeline",
    "fs-ent-pipeline-regex",
    "fs-query-index",
    "fs-query-index-merge",
    "fs-query-index-merge2",
    "fs-query-index-merge3",
    "fs-query-index-merge4",
    "fs-query-index-merge5",
    "fs-query-index-merge6",
    "fs-query-index-merge7",
    "fs-query-index-merge8",
    "fs-rules",
    "pubsub-resource-names",
    "securetoken-body",
  ]);
});

const literalsOf = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1]);
/** The file names a runner's private `harnessDigest` reads, from its source. */
const runnerDigestFiles = (runner) => {
  const text = readFileSync(join(CONFORMANCE_DIR, "src", runner), "utf8");
  const start = text.search(/function harnessDigest\(/);
  assert.ok(start >= 0, `${runner} has a harnessDigest`);
  const body = text.slice(start, text.indexOf("\n}\n", start));
  return literalsOf(body, /"([\w./-]+\.(?:mjs|js|json))"/g);
};

test("the registry lists the files each runner's own digest reads", () => {
  const runners = {
    "auth-account": "auth-account/run.mjs",
    "auth-action": "auth-action/run.mjs",
    "auth-config-sdk": "auth-config-sdk/run.mjs",
    "auth-credential": "auth-credential/run.mjs",
    "auth-mfa": "auth-mfa/run.mjs",
    "fs-query-index": "fs-query-index/run.mjs",
    "fs-data-write-list": "fs-query-index/run.mjs",
    "fs-config-lifecycle": "fs-config-lifecycle/run.mjs",
  };
  for (const [name, runner] of Object.entries(runners)) {
    const read = runnerDigestFiles(runner);
    const listed = HARNESS_LANES[name].files;
    // A runner may name a file relative to its own directory.
    for (const file of read)
      assert.ok(
        listed.some((f) => f.endsWith(file)),
        `${name}: ${file} is read but not listed`,
      );
    for (const file of listed)
      assert.ok(
        read.some((f) => file.endsWith(f)),
        `${name}: ${file} is listed but not read`,
      );
  }
});

test("the waived lanes list the files their digests read", () => {
  const federation = readFileSync(join(CONFORMANCE_DIR, "src/auth-federation/record.mjs"), "utf8");
  const region = federation.slice(
    federation.indexOf("export const SOURCES = ["),
    federation.indexOf("].map(", federation.indexOf("export const SOURCES = [")),
  );
  const sources = literalsOf(region, /"([\w./-]+\.mjs)"/g).map(
    (name) =>
      `conformance/src/${join("auth-federation", name).replace(/^auth-federation\/\.\.\//, "")}`,
  );
  for (const w of WAIVED_FIXTURES.filter((x) => x.fixture.startsWith("auth-federation")))
    assert.deepEqual(w.inputs.toSorted(), sources.toSorted(), w.fixture);
  const blocking = WAIVED_FIXTURES.find(
    (w) => w.fixture === "auth-tenant-blocking-production.json",
  );
  for (const file of runnerDigestFiles("auth-tenant-blocking/run.mjs"))
    assert.ok(
      blocking.inputs.some((input) => input.endsWith(`/${file}`)),
      `${file} is read by the runner but not listed`,
    );
});

test("every guarded and waived input exists, and is listed in `paths`", () => {
  const paths = new Set(registryPaths());
  for (const lane of Object.values(HARNESS_LANES))
    for (const path of lane.guarded ?? []) {
      assert.ok(existsSync(join(REPO_ROOT, path)), path);
      assert.ok(paths.has(path), path);
    }
  for (const waived of WAIVED_FIXTURES)
    for (const path of waived.inputs) {
      assert.ok(existsSync(join(REPO_ROOT, path)), path);
      assert.ok(paths.has(path), path);
    }
});

test("a rewrite of an input a waived lane shares is refused, even of a comment", () => {
  // auth-credential/tokens.mjs is an input of enrolled lanes and of the waived tenant-blocking lane.
  const file = "auth-credential/tokens.mjs";
  const report = rewriteReport(
    { [`conformance/src/${file}`]: `// a comment\n${readSrc(file)}` },
    NO_GIT,
  );
  assert.match(
    report.problems.join("\n"),
    /conformance\/src\/auth-credential\/tokens\.mjs: a rewrite changes an input the registry cannot follow: auth-tenant-blocking-production\.json/,
  );
  // An input only a waived lane reads, and a file that carries an enrolled lane's constants.
  for (const path of [
    "conformance/src/auth-tenant-blocking/session.mjs",
    "conformance/src/auth-federation/idp.mjs",
    "conformance/src/auth-account/authorized-domains.mjs",
    "conformance/src/auth-config-sdk/sandbox-baseline.mjs",
    "conformance/src/auth-account/corpus.mjs",
    "conformance/src/fs-rules/corpus.mjs",
    "conformance/fs-query-index.indexes.json",
  ]) {
    const text = readFileSync(join(REPO_ROOT, path), "utf8");
    const found = rewriteReport({ [path]: text.endsWith("\n") ? `${text} ` : `${text}\n` }, NO_GIT);
    assert.match(
      found.problems.join("\n"),
      new RegExp(`${path.replaceAll(".", "\\.")}: a rewrite changes`),
      path,
    );
  }
  // A file no lane reads is not affected.
  assert.deepEqual(rewriteReport({ "conformance/src/config.mjs": "// x\n" }, NO_GIT).problems, []);
});

test("the gate's binding problems include an unconnected lane, and a shallow clone by name", () => {
  const found = bindingProblems({ shallow: false, unconnected: () => ["x: not connected"] });
  assert.deepEqual(found, ["x: not connected"]);
  assert.deepEqual(bindingProblems({ shallow: false, unconnected: () => [] }), []);
  assert.match(
    bindingProblems({ shallow: true, unconnected: () => [] }).join("\n"),
    /shallow clone/,
  );
});

test("a real depth-1 clone is a shallow checkout and this one is not", () => {
  assert.equal(isShallowCheckout(), false);
  const dir = mkdtempSync(join(tmpdir(), "shallow-"));
  try {
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${REPO_ROOT}`, dir], {
      stdio: "ignore",
    });
    assert.equal(isShallowCheckout({ cwd: dir }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify prints the lanes and exits non-zero on any binding problem", () => {
  const report = {
    lanes: { lane: { state: "raw", saved: "s", current: "c" } },
    lineageProblems: [],
    enrollmentProblems: [],
  };
  const clean = verifyOutcome({ report, problems: [] });
  assert.equal(clean.exitCode, 0);
  assert.deepEqual(clean.lines, ["lane: raw (recorded s, current c)"]);
  assert.deepEqual(clean.errors, []);
  const bad = verifyOutcome({ report, problems: ["an entry is out of date"] });
  assert.equal(bad.exitCode, 1);
  assert.deepEqual(bad.errors, ["an entry is out of date"]);
  assert.equal(
    JSON.parse(verifyOutcome({ json: true, report, problems: [] }).lines[0]).lanes.lane.state,
    "raw",
  );
});

test("a waiver names inputs that exist", () => {
  const base = { fixture: "a-production.json", reason: "a reason long enough to count" };
  const problems = (waiver) =>
    enrollmentProblems({ fixtures: ["a-production.json"], lanes: {}, waived: [waiver] }).join("\n");
  assert.match(problems(base), /names no inputs to guard/);
  assert.match(problems({ ...base, inputs: [] }), /names no inputs to guard/);
  assert.match(
    problems({ ...base, inputs: ["conformance/src/no-such-file.mjs"] }),
    /the guarded input conformance\/src\/no-such-file\.mjs does not exist/,
  );
  assert.equal(problems({ ...base, inputs: ["conformance/src/config.mjs"] }), "");
});

test("the parser reports every real input's tokens already in source order", () => {
  // An inserted semicolon is reported at the end of the token before it, so the report order is
  // the position order and the sort is only a guard; this pins the property on the real inputs
  // and on the line-break cases.
  const ordered = (text, label) => {
    const at = tokensInReportOrder(text).map((token) => token.at);
    assert.deepEqual(
      at,
      at.toSorted((a, b) => a - b),
      label,
    );
  };
  for (const lane of Object.values(HARNESS_LANES))
    for (const file of lane.files) ordered(treeReader(file), file);
  for (const [joined, split] of ASI_PAIRS) {
    ordered(wrapAsi(joined), joined);
    ordered(wrapAsi(split), split);
  }
});

test("a rewrite of every frozen path is refused, whatever it is", () => {
  const frozen = frozenPaths();
  // The guarded data and constants of the enrolled lanes, and every waived input.
  assert.ok(frozen.size >= 30, `only ${frozen.size} frozen paths`);
  for (const lane of Object.values(HARNESS_LANES))
    for (const path of lane.guarded ?? []) assert.ok(frozen.has(path), path);
  for (const waived of WAIVED_FIXTURES)
    for (const path of waived.inputs) assert.ok(frozen.has(path), path);
  for (const path of frozen.keys()) {
    const text = readFileSync(join(REPO_ROOT, path), "utf8");
    const found = rewriteReport({ [path]: `${text}\n` }, NO_GIT);
    assert.ok(
      found.problems.some((p) =>
        p.startsWith(`${path}: a rewrite changes an input the registry cannot follow`),
      ),
      path,
    );
  }
});

test("the registry imports no lane runner, so importing it runs nothing", () => {
  // A runner reads its mode from process.argv at load and prints a usage line for an unknown one.
  for (const mode of ["check", "record-production", "local", "verify", "anything"]) {
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(new URL("./harness-registry.mjs", import.meta.url).href)});`,
        mode,
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, `${mode}: ${run.stderr}`);
    assert.equal(run.stdout + run.stderr, "", mode);
  }
  const text = readFileSync(join(CONFORMANCE_DIR, "src/harness-registry.mjs"), "utf8");
  assert.ok(!/\bimport\(/.test(text), "no dynamic import");
  assert.ok(!/from "\.\/[\w-]+\/run\.mjs"/.test(text), "no runner import");
});

test("a waived lane that can rebuild its digests must still match its fixture", () => {
  assert.deepEqual(waivedDigestProblems(), []);
  const blocking = WAIVED_FIXTURES.find(
    (w) => w.fixture === "auth-tenant-blocking-production.json",
  );
  assert.equal(typeof blocking.recompute, "function");
  const { tenant, blocking: withFixture } = blocking.recompute();
  assert.notEqual(tenant, withFixture);
  const recorded = new Set(
    Object.values(
      JSON.parse(readFileSync(join(CONFORMANCE_DIR, blocking.fixture), "utf8")).programs,
    ).map((p) => p.harnessDigest),
  );
  assert.deepEqual(recorded, new Set([tenant, withFixture]));
  const moved = waivedDigestProblems({
    waived: [{ ...blocking, recompute: () => ({ tenant: "0".repeat(64) }) }],
  });
  assert.match(moved.join("\n"), /is none of the digests its inputs give today/);
  assert.deepEqual(waivedDigestProblems({ waived: [{ ...blocking, recompute: undefined }] }), []);
  assert.deepEqual(bindingProblems({ shallow: false, waivedDigests: () => ["w: stale"] }), [
    "w: stale",
  ]);
  assert.deepEqual(bindingProblems({ shallow: false }), []);
});

test("the federation waiver says what its digests are", () => {
  const federation = WAIVED_FIXTURES.find((w) => w.fixture === "auth-federation-production.json");
  assert.match(federation.reason, /per-recording approval binding/);
  assert.match(federation.reason, /nothing compares it/);
});

// ---- "unreached" hops ----------------------------------------------------------------------------

// A lane with two sources and a data input, read at a revision through `dataReader`.
const UNREACHED_LANE = {
  files: ["a.mjs", "b.mjs"],
  extra: ({ data }) => data("lane.indexes.json"),
  fixture: "lane-production.json",
  guarded: ["conformance/lane.indexes.json"],
};
const REC = "1".repeat(40);
const BASE = "2".repeat(40);
const FIX = "3".repeat(40);
const B_TEXT = "export const b = 1;\n";
const DATA = '{"indexes":[]}\n';
const TREES = {
  // The recorded state, the base of the fix (a comment-only edit), the fix (today's tree).
  [REC]: { "a.mjs": "// recorded\nconst a = 1;\n", "b.mjs": B_TEXT },
  [BASE]: { "a.mjs": "// edited\nconst a = 1;\n", "b.mjs": B_TEXT },
  [FIX]: { "a.mjs": "const a = 1;\ntry { a; } catch {}\n", "b.mjs": B_TEXT },
};
const DATA_AT = { [REC]: DATA, [BASE]: DATA, [FIX]: DATA };
const treesReader = (commit) => (file) => {
  if (!TREES[commit]) throw new Error(`bad object ${commit}`);
  return TREES[commit][file];
};
const dataAt = (commit) => (path) => (path === "lane.indexes.json" ? DATA_AT[commit] : undefined);
const A_PATH = "conformance/src/a.mjs";
const DIFF_HASH = "d".repeat(64);
const CONDITIONS = {
  "no-failures": {
    base: BASE,
    fix: FIX,
    deltaSha256: DIFF_HASH,
    touches: [A_PATH],
    problems: (fixture) => (fixture.failures ?? []).map((failure) => `failure ${failure}`),
  },
};
const delta = (changed = [A_PATH, "unrelated/file.txt"], deltaSha256 = DIFF_HASH) => ({
  changed,
  deltaSha256,
});
const unreachedHop = () => ({
  lane: "lane",
  from: rawDigest(UNREACHED_LANE, (file) => TREES[REC][file], DATA),
  to: scheme2Digest(UNREACHED_LANE, (file) => TREES[FIX][file], DATA),
  commit: REC,
  kind: "unreached",
  fix: FIX,
  condition: "no-failures",
});
const unreachedProblems = (hop, overrides = {}) =>
  lineageProblems(
    { version: 1, hops: [hop] },
    {
      lanes: { lane: UNREACHED_LANE },
      reader: treesReader,
      dataReader: dataAt,
      shallow: false,
      current: (file) => TREES[FIX][file],
      currentInputs: { data: () => DATA },
      conditions: CONDITIONS,
      fixDelta: () => delta(),
      fixtureOf: () => ({ failures: [] }),
      ...overrides,
    },
  );
// lineageProblems reads today's data through the lane's default reader, which is this checkout's.

test("an unreached hop is sound when every part of its check holds", () => {
  assert.deepEqual(unreachedProblems(unreachedHop()), []);
});

test("an unreached hop needs its fix commit and a condition from the closed table", () => {
  assert.match(unreachedProblems({ ...unreachedHop(), fix: "abc" }).join("\n"), /fix is not/);
  assert.match(
    unreachedProblems({ ...unreachedHop(), condition: "anything" }).join("\n"),
    /closed table/,
  );
  assert.match(
    unreachedProblems({ ...unreachedHop(), condition: "__proto__" }).join("\n"),
    /closed table/,
  );
  const { fix: _fix, ...withoutFix } = unreachedHop();
  assert.match(unreachedProblems(withoutFix).join("\n"), /fix is not/);
  assert.match(unreachedProblems({ ...unreachedHop(), extra: 1 }).join("\n"), /unexpected/);
});

test("an unreached hop that names another fix commit than the condition approves is refused", () => {
  // A well-formed SHA that is not the approved one, whatever its history looks like.
  const found = unreachedProblems({ ...unreachedHop(), fix: "4".repeat(40) });
  assert.equal(found.length, 1);
  assert.match(found[0], /is not the one the condition approves/);
});

test("an unreached hop is refused when the change is not the approved one", () => {
  // Same commit, same touched file, same tokens before and after: another delta hashes differently.
  const found = unreachedProblems(unreachedHop(), {
    fixDelta: () => delta(undefined, "e".repeat(64)),
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /is not the approved one/);
});

test("fix and condition belong to unreached hops only", () => {
  const scheme = { ...goodHop(), fix: FIX, condition: "no-failures" };
  assert.match(problems([scheme]).join("\n"), /unexpected fix, condition/);
});

test("an unreached hop is refused when the recorded digest does not reproduce at its commit", () => {
  assert.match(
    unreachedProblems({ ...unreachedHop(), from: "9".repeat(64) }).join("\n"),
    /recorded digest does not reproduce/,
  );
});

test("an unreached hop is refused when the condition fails for the lane's fixture", () => {
  const found = unreachedProblems(unreachedHop(), { fixtureOf: () => ({ failures: ["p#s"] }) });
  assert.equal(found.length, 1);
  assert.match(found[0], /condition no-failures fails: failure p#s/);
});

test("an unreached hop is refused when the fix changes another input, or none of its own", () => {
  const changes = (...paths) => ({ fixDelta: () => delta(paths) });
  assert.match(
    unreachedProblems(unreachedHop(), changes(A_PATH, "conformance/src/b.mjs")).join("\n"),
    /changes the inputs \[conformance\/src\/a\.mjs,conformance\/src\/b\.mjs\]/,
  );
  assert.match(
    unreachedProblems(unreachedHop(), changes(A_PATH, "conformance/lane-production.json")).join(
      "\n",
    ),
    /changes the inputs/,
  );
  assert.match(
    unreachedProblems(unreachedHop(), changes("conformance/src/b.mjs")).join("\n"),
    /changes the inputs \[conformance\/src\/b\.mjs\], the condition allows exactly \[conformance\/src\/a\.mjs\]/,
  );
  assert.match(unreachedProblems(unreachedHop(), changes()).join("\n"), /allows exactly/);
});

test("an unreached hop is refused when the fix changes a data input of the lane's digest", () => {
  const found = unreachedProblems(unreachedHop(), {
    fixDelta: () => delta([A_PATH, "conformance/lane.indexes.json"]),
  });
  assert.equal(found.length, 1);
  assert.match(
    found[0],
    /changes the inputs \[conformance\/lane\.indexes\.json,conformance\/src\/a\.mjs\]/,
  );
});

test("an unreached hop is refused when the delta of the fix cannot be read", () => {
  assert.match(
    unreachedProblems(unreachedHop(), {
      fixDelta: () => {
        throw new Error("bad object");
      },
    }).join("\n"),
    /fix commit and its base are not readable/,
  );
});

test("an unreached hop is refused when more than comments changed before the base of the fix", () => {
  const trees = { ...TREES, [BASE]: { "a.mjs": "const a = 2;\n", "b.mjs": B_TEXT } };
  const found = unreachedProblems(unreachedHop(), {
    reader: (commit) => (file) => trees[commit][file],
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /changed between .* and the base of the fix/);
});

test("an unreached hop is refused when the data changed before the base of the fix", () => {
  const found = unreachedProblems(unreachedHop(), {
    dataReader: (commit) => (path) =>
      commit === BASE ? '{"indexes":[1]}\n' : dataAt(commit)(path),
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /changed between .* and the base of the fix/);
});

test("an unreached hop is refused when the tree changed again after the fix", () => {
  const later = (file) =>
    file === "a.mjs" ? "const a = 1;\ntry { a; } catch {}\nlater();\n" : B_TEXT;
  const found = unreachedProblems(unreachedHop(), { current: later });
  assert.equal(found.length, 1);
  assert.match(found[0], /current tree is not the hop's/);
});

test("an unreached hop is refused when the fix commit's tokens are not the hop's", () => {
  const trees = { ...TREES, [FIX]: { "a.mjs": "const a = 3;\n", "b.mjs": B_TEXT } };
  const found = unreachedProblems(unreachedHop(), {
    reader: (commit) => (file) => trees[commit][file],
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /at the fix commit is not the hop's/);
});

test("an unreached hop is refused when the history around the fix is not readable", () => {
  assert.match(
    unreachedProblems(unreachedHop(), {
      reader: (commit) => {
        if (commit === BASE) throw new Error("bad object");
        return treesReader(commit);
      },
    }).join("\n"),
    /fix commit and its base are not readable/,
  );
});

test("a hop is refused when a data input does not exist at the revision it is read at", () => {
  // At the hop's commit: the recorded digest reproduced from this checkout's data, not the commit's.
  for (const missingAt of [REC, BASE, FIX]) {
    const found = unreachedProblems(unreachedHop(), {
      dataReader: (commit) => (path) => (commit === missingAt ? undefined : dataAt(commit)(path)),
    });
    assert.equal(found.length, 1, missingAt);
    assert.match(found[0], /are not readable|data input is missing/, missingAt);
  }
  const throwing = unreachedProblems(unreachedHop(), {
    dataReader: (commit) => (path) => {
      if (commit === REC) throw new Error("path does not exist");
      return dataAt(commit)(path);
    },
  });
  assert.match(throwing.join("\n"), /sources at .* are not readable \(path does not exist\)/);
});

test("a hop is refused when a source does not exist at its commit", () => {
  const found = unreachedProblems(unreachedHop(), {
    reader: (commit) => (file) =>
      commit === REC && file === "b.mjs" ? undefined : treesReader(commit)(file),
  });
  assert.match(found.join("\n"), /b\.mjs is missing/);
});

test("the data a hop's digest reads is read at the hop's commit", () => {
  // The recorded digest was made from other data than the commit holds: it does not reproduce.
  const found = unreachedProblems(unreachedHop(), {
    dataReader: (commit) => (path) => (commit === REC ? '{"other":1}\n' : dataAt(commit)(path)),
  });
  assert.match(found.join("\n"), /recorded digest does not reproduce/);
});

test("the data read at the fix commit is the data the hop's scheme-2 digest was made from", () => {
  const found = unreachedProblems(unreachedHop(), {
    dataReader: (commit) => (path) => (commit === FIX ? '{"other":1}\n' : dataAt(commit)(path)),
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /at the fix commit is not the hop's/);
});

test("a scheme hop reads its data at its commit too", () => {
  // Same sources and tokens, other data at the hop's commit than in this checkout.
  const hop = {
    lane: "lane",
    from: rawDigest(UNREACHED_LANE, (file) => TREES[REC][file], DATA),
    to: scheme2Digest(UNREACHED_LANE, (file) => TREES[REC][file], DATA),
    commit: REC,
    kind: "scheme",
  };
  const run = (dataReader) =>
    lineageProblems(
      { version: 1, hops: [hop] },
      {
        lanes: { lane: UNREACHED_LANE },
        reader: treesReader,
        dataReader,
        shallow: false,
        current: (file) => TREES[REC][file],
        currentInputs: { data: () => DATA },
      },
    );
  assert.deepEqual(run(dataAt), []);
  // Today's data is DATA; at the commit it is something else, so the recorded digest and the
  // scheme-2 digest the hop claims were not made from the commit's inputs.
  const found = run(
    (commit) => (path) => (commit === REC ? '{"other":1}\n' : dataAt(commit)(path)),
  );
  assert.match(found.join("\n"), /does not reproduce/);
  assert.match(found.join("\n"), /scheme-2 digest at/);
});

test("an unreached hop in a shallow clone is a hard failure", () => {
  assert.match(unreachedProblems(unreachedHop(), { shallow: true }).join("\n"), /shallow/);
});

test("an unreached hop connects the recorded digest of its lane and no other", () => {
  const hop = unreachedHop();
  const state = (name, saved) =>
    checkFixtureDigest(name, { ...UNREACHED_LANE, extra: DATA }, saved, {
      read: (file) => TREES[FIX][file],
      lineage: [hop],
    }).state;
  assert.equal(state("lane", hop.from), "lineage");
  assert.equal(state("other", hop.from), "stale");
});

// ---- the body-read condition ---------------------------------------------------------------------

const fixtureOfSteps = (...steps) => ({
  programs: { p: { steps: Object.fromEntries(steps.map((step, i) => [`s${i}`, step])) } },
});

test("the body-read condition holds when every answer has a status or a gRPC code", () => {
  assert.deepEqual(
    bodyReadStageProblems(
      fixtureOfSteps(
        { status: 200, body: [] },
        { status: 400, body: {} },
        { status: 0, transportError: "TimeoutError" },
        { transport: "grpc", code: 0, body: [] },
        { code: 5 },
      ),
    ),
    [],
  );
});

test("the body-read condition fails for a body-stage transport error, whatever else holds", () => {
  const found = bodyReadStageProblems(
    fixtureOfSteps(
      { status: 200 },
      { status: 0, transportError: `${BODY_STAGE_PREFIX}TimeoutError` },
    ),
  );
  assert.deepEqual(found, ["p#s1: the body of the answer could not be read (body:TimeoutError)"]);
  // The marker is the prefix, so a fetch-stage code that merely contains it does not trip it.
  assert.deepEqual(
    bodyReadStageProblems(fixtureOfSteps({ status: 0, transportError: "nobody:error" })),
    [],
  );
});

test("the body-read condition fails closed for an answer it cannot classify", () => {
  assert.match(
    bodyReadStageProblems(fixtureOfSteps({ status: 0 })).join("\n"),
    /status 0 without a transport error/,
  );
  assert.match(
    bodyReadStageProblems(fixtureOfSteps({ body: [] })).join("\n"),
    /neither a numeric status nor a numeric gRPC code/,
  );
  assert.match(
    bodyReadStageProblems(fixtureOfSteps({ status: "200" })).join("\n"),
    /neither a numeric status/,
  );
  assert.match(bodyReadStageProblems(fixtureOfSteps(null)).join("\n"), /neither a numeric/);
  for (const empty of [{}, { programs: {} }, { programs: { p: { steps: {} } } }, undefined])
    assert.match(bodyReadStageProblems(empty).join("\n"), /records no answer/);
});

test("the body-read condition visits the second answer of a program too", () => {
  const program = {
    steps: { s: { status: 200 } },
    second: { s: { status: 0, transportError: `${BODY_STAGE_PREFIX}TimeoutError` } },
  };
  assert.deepEqual(bodyReadStageProblems({ programs: { p: program } }), [
    "p#s (second): the body of the answer could not be read (body:TimeoutError)",
  ]);
  assert.deepEqual(
    bodyReadStageProblems({ programs: { p: { ...program, second: { s: { status: 200 } } } } }),
    [],
  );
});

test("the body-read condition refuses a program with a key it does not know", () => {
  const found = bodyReadStageProblems({
    programs: { p: { steps: { s: { status: 200 } }, third: { s: { status: 0 } } } },
  });
  assert.deepEqual(found, ["p: unexpected key third"]);
});

// A fixture program and the corpus program it was recorded from, for the -1 rows.
const sha = (text) => createHash("sha256").update(text).digest("hex");
const REF = { $from: "dep", path: "nextPageToken" };
const unresolvedRow = {
  status: -1,
  unresolved: "step dep recorded nothing at nextPageToken",
  dependencyTransient: false,
};
const scenario = ({ steps, refs = [REF], digest, corpusSteps, change = {} }) => {
  const rows = { ...steps };
  rows.row = { ...(rows.row ?? unresolvedRow), ...change };
  const program = {
    id: "p",
    steps: corpusSteps ?? [{ id: "dep" }, { id: "row", query: [["pageToken", refs]] }],
  };
  const fixture = {
    programs: { p: { corpusDigest: digest ?? sha(JSON.stringify(program)), steps: rows } },
  };
  return bodyReadStageProblems(fixture, { p: program });
};
const DEP = { status: 200, body: [{}] };

test("the body-read condition accepts a -1 row only when the fixture proves its request could not be built", () => {
  const check = (change, steps = { dep: DEP }, refs) => scenario({ steps, change, refs });
  assert.deepEqual(check({}), []);
  const none = "status -1 without the dependency evidence the recorder writes";
  assert.deepEqual(check({ unresolved: undefined }), [`p#row: ${none}`]);
  assert.deepEqual(check({ unresolved: 7 }), [`p#row: ${none}`]);
  assert.deepEqual(check({ unresolved: "step dep recorded nothing" }), [`p#row: ${none}`]);
  assert.deepEqual(check({ unresolved: "TimeoutError: the body timed out" }), [`p#row: ${none}`]);
  assert.deepEqual(check({ unresolved: ["step dep recorded nothing at nextPageToken"] }), [
    `p#row: ${none}`,
  ]);
  // The whole message is the recorder's: text before it or after a line break is not.
  assert.deepEqual(check({ unresolved: "Error: step dep recorded nothing at nextPageToken" }), [
    `p#row: ${none}`,
  ]);
  assert.deepEqual(check({ unresolved: "step dep recorded nothing at nextPageToken\nmore" }), [
    `p#row: ${none}`,
  ]);
  // The predecessor must be an earlier step of the slot, by its own key.
  const notEarlier = (name) =>
    `p#row: status -1 names ${name}, which is not an earlier step of its slot`;
  for (const name of ["ghost", "row", "constructor", "__proto__", "toString", "hasOwnProperty"])
    assert.deepEqual(
      check({ unresolved: `step ${name} recorded nothing at nextPageToken` }, { dep: DEP }, [
        { $from: name, path: "nextPageToken" },
      ]),
      [notEarlier(name)],
    );
  assert.deepEqual(
    scenario({ steps: { row: unresolvedRow, dep: DEP }, refs: [REF] }).join("\n"),
    notEarlier("dep"),
  );
  // The recorder's own flag for the predecessor.
  const flag = "p#row: status -1 whose dependencyTransient is not that of step dep";
  assert.deepEqual(check({ dependencyTransient: true }), [flag]);
  assert.deepEqual(check({ dependencyTransient: undefined }), [flag]);
  // A predecessor that recorded the path means the request was built and reached fetch.
  const recorded = (body) => check({}, { dep: { status: 200, body } });
  assert.deepEqual(recorded({ nextPageToken: "<page-token>" }), [
    "p#row: status -1 references nextPageToken, which step dep did record",
  ]);
  assert.deepEqual(recorded({ nextPageToken: "" }), []);
  assert.deepEqual(recorded({ documents: [] }), []);
  assert.deepEqual(check({}, { dep: { status: 200 } }), []);
  const nested = { unresolved: "step dep recorded nothing at a.b" };
  const nestedRef = [{ $from: "dep", path: "a.b" }];
  assert.deepEqual(check(nested, { dep: { status: 200, body: { a: { b: 1 } } } }, nestedRef), [
    "p#row: status -1 references a.b, which step dep did record",
  ]);
  assert.deepEqual(check(nested, { dep: { status: 200, body: { a: null } } }, nestedRef), []);
  // A predecessor whose fetch failed recorded nothing; a gRPC predecessor cannot prove it.
  assert.deepEqual(
    check({ dependencyTransient: true }, { dep: { status: 0, transportError: "ECONNRESET" } }),
    [],
  );
  assert.deepEqual(check({}, { dep: { code: 0, body: [] } }), [
    "p#row: status -1 after step dep, which is not a REST answer",
  ]);
  // A predecessor that is itself such a row has its own transience and its own proof.
  const chainedRefs = [
    { id: "first" },
    { id: "dep", query: [["pageToken", [{ $from: "first", path: "t" }]]] },
    { id: "row", query: [["pageToken", [{ $from: "dep", path: "t" }]]] },
  ];
  const chain = (first) =>
    scenario({
      steps: {
        first,
        dep: {
          status: -1,
          unresolved: "step first recorded nothing at t",
          dependencyTransient: false,
        },
      },
      corpusSteps: chainedRefs,
      change: { unresolved: "step dep recorded nothing at t" },
    });
  assert.deepEqual(chain(DEP), []);
  assert.deepEqual(chain({ status: 200, body: { t: "x" } }), [
    "p#dep: status -1 references t, which step first did record",
  ]);
});

test("a -1 row needs the failed step's own corpus request to reference the named step and path", () => {
  const missing =
    "p#row: status -1 names dep at nextPageToken, which the request of step row does not reference";
  const check = (options) => scenario({ steps: { dep: DEP }, ...options });
  assert.deepEqual(check({}), []);
  // The step never references it (the body failure of a request that carried no page token).
  assert.deepEqual(check({ refs: [] }), [missing]);
  assert.deepEqual(check({ corpusSteps: [{ id: "dep" }, { id: "row" }] }), [missing]);
  // It references another step, or another path of the named one.
  assert.deepEqual(check({ refs: [{ $from: "other", path: "nextPageToken" }] }), [missing]);
  assert.deepEqual(check({ refs: [{ $from: "dep", path: "other" }] }), [missing]);
  // The reference may sit anywhere in the request, beside others.
  assert.deepEqual(
    check({
      corpusSteps: [
        { id: "dep" },
        { id: "row", body: { a: [{ b: { $from: "x", path: "y" } }, REF] } },
      ],
    }),
    [],
  );
  // Only the request's own references count, never inherited ones.
  const inherited = Object.create(REF);
  assert.deepEqual(
    check({ corpusSteps: [{ id: "dep" }, { id: "row", query: [["pageToken", inherited]] }] }),
    [missing],
  );
  // The corpus step is the fixture's own: the same program by id, hashing to the saved digest.
  assert.deepEqual(check({ digest: "0".repeat(64) }), [missing]);
  const program = { id: "p", steps: [{ id: "dep" }, { id: "row", query: [REF] }] };
  const fixture = {
    programs: {
      p: { corpusDigest: sha(JSON.stringify(program)), steps: { dep: DEP, row: unresolvedRow } },
    },
  };
  assert.deepEqual(bodyReadStageProblems(fixture, { p: program }), []);
  assert.deepEqual(bodyReadStageProblems(fixture, {}), [missing]);
  assert.deepEqual(bodyReadStageProblems(fixture), [missing]);
  assert.deepEqual(bodyReadStageProblems(fixture, { other: program }), [missing]);
  assert.deepEqual(
    bodyReadStageProblems(fixture, {
      p: { ...program, steps: [{ id: "dep" }, { id: "row", query: [REF] }, { id: "extra" }] },
    }),
    [missing],
  );
  // A step id of the corpus that is not the row's.
  assert.deepEqual(check({ corpusSteps: [{ id: "dep" }, { id: "other", query: [REF] }] }), [
    missing,
  ]);
});

test("a -1 proof reads only the fields the request builder resolves, and only a REST predecessor", () => {
  const ref = { $from: "dep", path: "nextPageToken" };
  const check = (rowStep, depStep = { id: "dep" }, steps = { dep: DEP }) =>
    scenario({ steps, corpusSteps: [depStep, { id: "row", ...rowStep }] });
  const missing =
    "p#row: status -1 names dep at nextPageToken, which the request of step row does not reference";
  // REST: query and body are resolved, body only when no rawBody is sent instead.
  assert.deepEqual(check({ query: [["pageToken", ref]] }), []);
  assert.deepEqual(check({ body: { a: [ref] } }), []);
  assert.deepEqual(check({ rawBody: "{}", body: { a: ref } }), [missing]);
  assert.deepEqual(check({ rawBody: "{}", query: [["pageToken", ref]] }), []);
  assert.deepEqual(check({ path: "x", collectionId: "c", parent: ref }), [missing]);
  // gRPC: only body is resolved, never query.
  assert.deepEqual(check({ transport: "grpc", body: { pageToken: ref } }), []);
  assert.deepEqual(check({ transport: "grpc", query: [["pageToken", ref]] }), [missing]);
  assert.deepEqual(check({ transport: "grpc", rawBody: "{}", body: ref }), []);
  // References nested in $time and $array are still references.
  assert.deepEqual(check({ body: { t: { $time: { ...ref, addSeconds: 1 } } } }), []);
  assert.deepEqual(check({ body: { $array: { count: 2, item: { v: ref } } } }), []);
  // The predecessor is a REST step by the corpus, whatever status the fixture gives it.
  const notRest = "p#row: status -1 after step dep, which is not a REST answer";
  const query = { query: [["pageToken", ref]] };
  assert.deepEqual(check(query, { id: "dep", transport: "grpc" }), [notRest]);
  assert.deepEqual(check(query, { id: "dep", transport: "rest" }), []);
  assert.deepEqual(
    scenario({ steps: { dep: DEP }, corpusSteps: [{ id: "other" }, { id: "row", ...query }] }),
    [notRest],
  );
});

test("the forgeries of the review are refused on the real fixture: a gRPC predecessor and an ignored body", async () => {
  const { PROGRAMS } = await import("./fs-list/corpus.mjs");
  const corpus = Object.fromEntries(PROGRAMS.map((program) => [program.id, program]));
  const fixture = JSON.parse(
    readFileSync(join(CONFORMANCE_DIR, "fs-data-write-list-production.json"), "utf8"),
  );
  const grpcId = "fs-data-write-list/grpc/list-documents";
  const forged = structuredClone(fixture);
  forged.programs[grpcId].steps["page-size-2"] = { status: 200, body: {} };
  forged.programs[grpcId].steps["page-2"] = {
    status: -1,
    unresolved: "step page-size-2 recorded nothing at nextPageToken",
    dependencyTransient: false,
  };
  assert.deepEqual(bodyReadStageProblems(forged, corpus), [
    `${grpcId}#page-2: status -1 after step page-size-2, which is not a REST answer`,
  ]);
  // A digest-matched corpus step whose reference sits in a body that rawBody makes the builder ignore.
  const ref = { $from: "dep", path: "nextPageToken" };
  const program = {
    id: "p",
    steps: [
      { id: "dep" },
      { id: "row", rpc: "commit", rawBody: '{"writes":[]}', body: { a: ref } },
    ],
  };
  const ignored = {
    programs: {
      p: { corpusDigest: sha(JSON.stringify(program)), steps: { dep: DEP, row: unresolvedRow } },
    },
  };
  assert.deepEqual(bodyReadStageProblems(ignored, { p: program }), [
    "p#row: status -1 names dep at nextPageToken, which the request of step row does not reference",
  ]);
});

test("the recorded -1 rows of the checked-in fixtures all carry that evidence, and forging one is refused", async () => {
  const { PROGRAMS } = await import("./fs-list/corpus.mjs");
  const corpus = Object.fromEntries(PROGRAMS.map((program) => [program.id, program]));
  const fixture = JSON.parse(
    readFileSync(join(CONFORMANCE_DIR, "fs-data-write-list-production.json"), "utf8"),
  );
  assert.deepEqual(bodyReadStageProblems(fixture, corpus), []);
  const rows = Object.entries(fixture.programs).flatMap(([id, program]) =>
    Object.entries(program.steps)
      .filter(([, row]) => row.status === -1)
      .map(([stepId]) => [id, stepId]),
  );
  assert.equal(rows.length, 5);
  for (const [id, stepId] of rows) {
    const forged = structuredClone(fixture);
    delete forged.programs[id].steps[stepId].unresolved;
    assert.match(
      bodyReadStageProblems(forged, corpus).join("\n"),
      /without the dependency evidence/,
    );
    // Without the corpus nothing proves it.
    assert.match(bodyReadStageProblems(fixture).join("\n"), /does not reference/);
  }
  const interleaved = "fs-data-write-list/list-documents/missing-interleaved";
  const forge = (stepId, unresolved) => {
    const forged = structuredClone(fixture);
    forged.programs[interleaved].steps[stepId] = {
      status: -1,
      unresolved,
      dependencyTransient: false,
    };
    return bodyReadStageProblems(forged, corpus);
  };
  // A forged -1 after a real page that did record its token is refused: its predecessor recorded it.
  assert.ok(fixture.programs[interleaved].steps["page-size-1"].body.nextPageToken);
  assert.deepEqual(
    forge("page-size-1-next", "step page-size-1 recorded nothing at nextPageToken"),
    [
      `${interleaved}#page-size-1-next: status -1 references nextPageToken, which step page-size-1 did record`,
    ],
  );
  // A body failure of a request that carries no page token, with a message that imitates one whose
  // named step really lacks the token (the review's replay of show-missing-page-size-2).
  assert.ok(!("nextPageToken" in fixture.programs[interleaved].steps["page-size-1-next"].body));
  assert.deepEqual(
    forge("show-missing-page-size-2", "step page-size-1-next recorded nothing at nextPageToken"),
    [
      `${interleaved}#show-missing-page-size-2: status -1 names page-size-1-next at nextPageToken, which the request of step show-missing-page-size-2 does not reference`,
    ],
  );
  // A body-stage failure in the second answer of a real program is found too.
  const [secondId] = Object.entries(fixture.programs).find(([, program]) => program.second) ?? [];
  const forged = structuredClone(fixture);
  const [stepId] = Object.keys(forged.programs[secondId].second);
  forged.programs[secondId].second[stepId] = {
    status: 0,
    transportError: `${BODY_STAGE_PREFIX}TimeoutError`,
  };
  assert.match(
    bodyReadStageProblems(forged, corpus).join("\n"),
    /\(second\): the body of the answer/,
  );
});

test("the closed table names the one approved change the ten FS-QUERY-INDEX lanes share", () => {
  assert.deepEqual(Object.keys(UNREACHED_CONDITIONS), ["fs-query-index-body-read-unreached"]);
  const condition = UNREACHED_CONDITIONS["fs-query-index-body-read-unreached"];
  assert.deepEqual(condition.touches, ["conformance/src/fs-query-index/session.mjs"]);
  assert.equal(condition.problems, bodyReadStageProblems);
  for (const sha of [condition.base, condition.fix]) assert.match(sha, /^[0-9a-f]{40}$/);
  assert.match(condition.deltaSha256, /^[0-9a-f]{64}$/);
  const lanes = Object.entries(HARNESS_LANES).filter(([, lane]) =>
    lane.files.includes("fs-query-index/session.mjs"),
  );
  assert.equal(lanes.length, 10);
});

test("the approved change is what git holds: the same diff hash, and one input changed", () => {
  if (isShallowCheckout() && process.env.FIREEMU_REQUIRE_FULL_HISTORY !== "1") return;
  const { base, fix, touches, deltaSha256 } =
    UNREACHED_CONDITIONS["fs-query-index-body-read-unreached"];
  const found = gitFixDelta(base, fix, touches);
  assert.equal(found.deltaSha256, deltaSha256);
  const [lane] = Object.values(HARNESS_LANES).filter((l) =>
    l.files.includes("fs-query-index/session.mjs"),
  );
  assert.ok(found.changed.includes(touches[0]));
  assert.ok(!found.changed.includes(`conformance/src/${lane.files[0]}`));
});

// ---- generating the hops -------------------------------------------------------------------------

const GENERATED = {
  lane1: { ...UNREACHED_LANE, fixture: "one.json" },
  lane2: { ...UNREACHED_LANE, fixture: "two.json" },
  other: { files: ["b.mjs"], extra: "", fixture: "other.json" },
};
const rawAtBase = (name) => rawDigest(GENERATED[name], (file) => TREES[BASE][file], DATA);
const fixtures = {
  "one.json": { programs: { p: { harnessDigest: rawAtBase("lane1") } } },
  "two.json": { programs: { p: { harnessDigest: rawAtBase("lane2") } } },
  "other.json": { programs: { p: { harnessDigest: "b".repeat(64) } } },
};
const propose = (overrides = {}) =>
  proposeUnreachedHops({
    condition: "no-failures",
    lanes: GENERATED,
    lineage: { version: 1, hops: [] },
    reader: treesReader,
    dataReader: dataAt,
    current: (file) => TREES[FIX][file],
    currentInputs: { data: () => DATA },
    conditions: CONDITIONS,
    fixtureOf: (lane) => fixtures[lane.fixture],
    ...overrides,
  });

test("the generator proposes one hop per recorded digest of each lane that reads the fixed file", () => {
  const hops = propose();
  assert.deepEqual(
    hops.map((hop) => hop.lane),
    ["lane1", "lane2"],
  );
  for (const hop of hops) {
    assert.equal(hop.kind, "unreached");
    assert.equal(hop.fix, FIX);
    assert.equal(hop.commit, BASE);
    assert.equal(hop.condition, "no-failures");
    assert.equal(
      hop.to,
      scheme2Digest(GENERATED[hop.lane], (file) => TREES[FIX][file], DATA),
    );
  }
  assert.equal(hops[0].from, rawAtBase("lane1"));
  // A lane with two distinct recorded digests gets a hop for each.
  const two = propose({
    fixtureOf: (lane) =>
      lane.fixture === "two.json"
        ? {
            programs: {
              p: { harnessDigest: rawAtBase("lane2") },
              q: { harnessDigest: rawAtBase("lane1") },
            },
          }
        : fixtures[lane.fixture],
    lanes: { lane2: GENERATED.lane2 },
  });
  assert.equal(two.length, 1);
});

test("the generator refuses a recorded digest that does not reproduce at the base", () => {
  assert.throws(
    () =>
      propose({
        fixtureOf: (lane) =>
          lane.fixture === "two.json"
            ? { programs: { p: { harnessDigest: "a".repeat(64) } } }
            : fixtures[lane.fixture],
      }),
    /lane2: the recorded digest a+ does not reproduce/,
  );
  // The data the digest read is the base's, not this checkout's.
  assert.throws(
    () =>
      propose({
        dataReader: (commit) => (path) => (commit === BASE ? "{}" : dataAt(commit)(path)),
      }),
    /does not reproduce/,
  );
});

test("the generator skips a hop the lineage already has, and refuses an unknown condition", () => {
  const once = propose();
  assert.deepEqual(propose({ lineage: { version: 1, hops: once } }), []);
  assert.deepEqual(propose({ lineage: { version: 1, hops: [once[0]] } }), [once[1]]);
  assert.throws(() => propose({ condition: "nope" }), /closed table/);
  assert.throws(() => propose({ condition: "__proto__" }), /closed table/);
});

test("the checked-in unreached hops are exactly what the generator proposes for their condition", () => {
  const lineage = loadLineage();
  const unreached = lineage.hops.filter((hop) => hop.kind === "unreached");
  assert.equal(unreached.length, 10, "one hop for each recorded harness digest of ten lanes");
  for (const condition of new Set(unreached.map((hop) => hop.condition))) {
    const mine = unreached.filter((hop) => hop.condition === condition);
    const without = { ...lineage, hops: lineage.hops.filter((hop) => !mine.includes(hop)) };
    assert.deepEqual(proposeUnreachedHops({ condition, lineage: without }), mine);
    for (const hop of mine) assert.equal(hop.fix, UNREACHED_CONDITIONS[condition].fix);
  }
});

test("every recorded harness digest of the ten lanes is connected without a waiver", () => {
  for (const [name, lane] of Object.entries(HARNESS_LANES)) {
    if (!lane.files.includes("fs-query-index/session.mjs")) continue;
    const fixture = JSON.parse(readFileSync(join(CONFORMANCE_DIR, lane.fixture), "utf8"));
    for (const saved of recordedDigests(name, fixture))
      assert.notEqual(checkFixtureDigest(name, lane, saved).state, "stale", `${name} ${saved}`);
  }
  assert.equal(
    WAIVED_FIXTURES.some((waived) => /query-index|data-write-list/.test(waived.fixture)),
    false,
  );
});

test("a real hop moved to a commit that lacks the lane's index file is refused", () => {
  // 9ef5974b3 predates fs-query-index-merge8.indexes.json: the recorded digest reproduced from this
  // checkout's copy of the file before the data was read at the hop's commit.
  const commit = "9ef5974b3d726f95bf7126ac6b0c6ba42442b093";
  if (isShallowCheckout()) return;
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: REPO_ROOT });
  } catch {
    return;
  }
  const lineage = loadLineage();
  const hops = lineage.hops.map((hop) =>
    hop.lane === "fs-query-index-merge8" ? { ...hop, commit } : hop,
  );
  const found = lineageProblems(
    { ...lineage, hops },
    { lanes: HARNESS_LANES, reader: gitReader, shallow: false },
  );
  assert.match(found.join("\n"), /fs-query-index-merge8\.indexes\.json|are not readable/);
});

// ---- rewrites of a condition's fixture -------------------------------------------------------------

test("a rewrite that changes only a lane's fixture is checked against the lineage's conditions", () => {
  const fixturePath = "conformance/fs-query-index-production.json";
  const fixture = JSON.parse(readFileSync(join(REPO_ROOT, fixturePath), "utf8"));
  const [program] = Object.values(fixture.programs);
  const [stepId] = Object.keys(program.steps);
  program.steps[stepId] = { status: 0, transportError: `${BODY_STAGE_PREFIX}TimeoutError` };
  // The lineage file itself is not in the rewrite.
  const report = rewriteReport({ [fixturePath]: JSON.stringify(fixture) });
  assert.match(
    report.problems.join("\n"),
    /lineage after the rewrite: hop \d+: condition fs-query-index-body-read-unreached fails/,
  );
  // With the lineage file in the rewrite too, the same refusal.
  const lineage = readFileSync(join(REPO_ROOT, "conformance/harness-lineage.json"), "utf8");
  assert.match(
    rewriteReport({
      "conformance/harness-lineage.json": lineage,
      [fixturePath]: JSON.stringify(fixture),
    }).problems.join("\n"),
    /condition fs-query-index-body-read-unreached fails/,
  );
});

test("a rewrite of a fixture no unreached hop reads does not re-check the lineage", () => {
  // auth-fs-cross is connected by a scheme hop, which does not read its fixture.
  const fixturePath = "conformance/auth-fs-cross-production.json";
  const fixture = readFileSync(join(REPO_ROOT, fixturePath), "utf8");
  const report = rewriteReport({ [fixturePath]: fixture }, NO_GIT);
  assert.ok(!report.problems.some((problem) => /lineage after the rewrite/.test(problem)));
});

// ---- the fix commit as git reports it --------------------------------------------------------------

test("gitFixDelta reports the changed paths and a hash of the delta that no configuration changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "fix-delta-"));
  try {
    // A throwaway repository with no configuration of the machine in it.
    const env = {
      PATH: process.env.PATH,
      HOME: dir,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    };
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: dir,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    git("init", "-q", "-b", "main");
    const lines = (count, text) => `${text}\n`.repeat(count);
    writeFileSync(join(dir, "kept.txt"), "kept\n");
    writeFileSync(join(dir, "old.txt"), lines(5, "a long enough body to be a rename"));
    writeFileSync(join(dir, "input.mjs"), `${lines(20, "export const a = 1;")}\n${lines(2, "x")}`);
    writeFileSync(join(dir, "ünï.txt"), "unicode name\n");
    mkdirSync(join(dir, "sub", "dir"), { recursive: true });
    writeFileSync(join(dir, "sub", "dir", "nested.txt"), "nested\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    git("mv", "old.txt", "new.txt");
    writeFileSync(join(dir, "kept.txt"), "kept again\n");
    writeFileSync(join(dir, "ünï.txt"), "unicode name again\n");
    writeFileSync(
      join(dir, "input.mjs"),
      `${lines(10, "export const a = 1;")}export const b = 2;\n${lines(10, "export const a = 1;")}\n${lines(2, "x")}`,
    );
    writeFileSync(join(dir, "added.txt"), "added\n");
    writeFileSync(join(dir, "sub", "dir", "nested.txt"), "nested again\n");
    git("add", ".");
    git("commit", "-q", "-m", "fix");
    const fix = git("rev-parse", "HEAD");
    const found = gitFixDelta(base, fix, ["input.mjs"], dir);
    assert.deepEqual(found.changed, [
      "added.txt",
      "input.mjs",
      "kept.txt",
      "new.txt",
      "old.txt",
      "sub/dir/nested.txt",
      "ünï.txt",
    ]);
    assert.match(found.deltaSha256, /^[0-9a-f]{64}$/);
    // Only the named paths are hashed, and a path that did not exist at a revision is its own case.
    for (const paths of [["kept.txt"], ["input.mjs", "kept.txt"], ["input.mjs", "added.txt"], []])
      assert.notEqual(gitFixDelta(base, fix, paths, dir).deltaSha256, found.deltaSha256);
    assert.notEqual(
      gitFixDelta(base, fix, ["added.txt"], dir).deltaSha256,
      gitFixDelta(base, fix, ["gone.txt"], dir).deltaSha256,
    );
    // Configuration that changes how git prints or finds a diff does not change either result.
    for (const [key, value] of [
      ["diff.noprefix", "true"],
      ["diff.mnemonicPrefix", "true"],
      ["diff.context", "9"],
      ["diff.interHunkContext", "5"],
      ["diff.algorithm", "patience"],
      ["diff.renames", "copies"],
      ["diff.suppressBlankEmpty", "true"],
      ["diff.external", "false"],
      ["color.ui", "always"],
      ["core.quotepath", "true"],
      ["core.abbrev", "12"],
    ])
      git("config", key, value);
    assert.deepEqual(gitFixDelta(base, fix, ["input.mjs"], dir), found);
    // A different change to the same file hashes differently.
    writeFileSync(join(dir, "input.mjs"), "export const a = 9;\n");
    git("commit", "-q", "-am", "other");
    const other = gitFixDelta(base, git("rev-parse", "HEAD"), ["input.mjs"], dir);
    assert.notEqual(other.deltaSha256, found.deltaSha256);
    assert.throws(() => gitFixDelta(base, "0".repeat(40), ["input.mjs"], dir));
    assert.throws(() => gitFixDelta("0".repeat(40), fix, ["input.mjs"], dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the lane runner's stale check ------------------------------------------------------------------

test("the lane runner accepts a recorded digest the registry connects by lineage, and refuses an unknown one", async () => {
  const { harnessDigest, harnessDigestIsStale } = await import("./fs-query-index/run.mjs");
  const fixture = JSON.parse(
    readFileSync(join(CONFORMANCE_DIR, "fs-query-index-production.json"), "utf8"),
  );
  const [saved] = recordedDigests("fs-query-index", fixture);
  const current = await harnessDigest();
  // The runner's own raw digest of today's sources is not the recorded one: the lineage connects it.
  assert.notEqual(saved, current);
  assert.equal(laneStatus("fs-query-index", HARNESS_LANES["fs-query-index"]).state, "lineage");
  assert.equal(harnessDigestIsStale(saved, current), false);
  assert.equal(harnessDigestIsStale(current, current), false);
  assert.equal(harnessDigestIsStale("0".repeat(64), current), true);
});

test("the lane runner compares digests plainly for a lane the registry does not enroll", () => {
  const script = `
    const { harnessDigestIsStale } = await import(${JSON.stringify(new URL("./fs-query-index/run.mjs", import.meta.url).href)});
    console.log(JSON.stringify([harnessDigestIsStale("a", "a"), harnessDigestIsStale("a", "b")]));`;
  const { stdout } = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, FIREEMU_SANDBOX_LANE: "fs-ent-text" },
    encoding: "utf8",
  });
  assert.equal(HARNESS_LANES["fs-ent-text"], undefined);
  assert.deepEqual(JSON.parse(stdout), [false, true]);
});

test("the lane runner does not call a committed row of the shared layer stale, and calls a changed one stale", async () => {
  const { harnessDigest, rowIsStale } = await import("./fs-query-index/run.mjs");
  const { PROGRAMS } = await import("./fs-query-index/corpus.mjs");
  const fixture = JSON.parse(
    readFileSync(join(CONFORMANCE_DIR, "fs-query-index-production.json"), "utf8"),
  );
  const current = await harnessDigest();
  for (const [id, saved] of Object.entries(fixture.programs)) {
    const program = PROGRAMS.find((candidate) => candidate.id === id);
    assert.equal(rowIsStale(saved, program, current), false, id);
    assert.equal(rowIsStale({ ...saved, harnessDigest: "0".repeat(64) }, program, current), true);
    assert.equal(rowIsStale({ ...saved, corpusDigest: "0".repeat(64) }, program, current), true);
    assert.equal(rowIsStale(undefined, program, current), false);
  }
  // check() decides staleness through that function, not through a second comparison.
  const source = readFileSync(join(CONFORMANCE_DIR, "src/fs-query-index/run.mjs"), "utf8");
  assert.match(source, /const stale = rowIsStale\(saved, program, harness\);/);
  assert.doesNotMatch(source, /saved\.harnessDigest !== harness/);
});

// ---- module exports are the revision's only when their sources are identical -----------------------

const MODULES = {
  "src/m.mjs":
    'import { y } from "./sub/y.mjs";\nimport fs from "node:fs";\nimport pkg from "pkg";\nexport * from "./z.mjs";\nexport const X = { n: 1 };\n',
  "src/sub/y.mjs": 'export const y = 1;\nawait import("../w.mjs");\nexport { v } from "./v.mjs";\n',
  "src/z.mjs": "export const Z = 2;\n",
  "src/w.mjs": "export {};\n",
  "src/sub/v.mjs": 'export const v = 3;\nimport "./y.mjs";\n',
  "src/unrelated.mjs": "export const U = 1;\n",
};
const CLOSURE = ["m.mjs", "sub/v.mjs", "sub/y.mjs", "w.mjs", "z.mjs"];

test("the files a module comes from are itself and everything it imports by a relative specifier", () => {
  assert.deepEqual(
    importClosure("m.mjs", (path) => MODULES[path]),
    CLOSURE,
  );
  // Each file is read once, so a cycle ends at once (a second read of any file fails the test).
  const reads = new Set();
  assert.deepEqual(
    importClosure("sub/y.mjs", (path) => {
      assert.ok(!reads.has(path), `${path} was read twice`);
      reads.add(path);
      return MODULES[path];
    }),
    ["sub/v.mjs", "sub/y.mjs", "w.mjs"],
  );
  // Static, re-exported, side-effect and literal dynamic imports; cycles end; bare and node: are not sources.
  assert.deepEqual(
    importClosure("w.mjs", (path) => MODULES[path]),
    ["w.mjs"],
  );
  // A dynamic import that is not a string literal cannot be followed, so it refuses.
  for (const source of [
    'const p = "./dep.mjs"; await import(p);',
    'await import("./" + "dep.mjs");',
    "await import(`./dep.mjs`);",
    'await import(await Promise.resolve("./dep.mjs"));',
  ])
    assert.throws(
      () => importClosure("c.mjs", (path) => (path === "src/c.mjs" ? source : "export {};")),
      /computed specifier/,
      source,
    );
  // A JSON module is a leaf: listed, compared as bytes, never parsed and never followed.
  const withJson = (path) =>
    ({
      "src/j.mjs":
        'import a from "./sub/dep.json" with { type: "json" };\nawait import("./other.json");\nimport b from "./attr.data" with { type: "json" };\n',
      "src/sub/dep.json": '{"not": "javascript" ',
      "src/other.json": "not even json",
      "src/attr.data": "also not javascript",
    })[path];
  assert.deepEqual(importClosure("j.mjs", withJson), [
    "attr.data",
    "j.mjs",
    "other.json",
    "sub/dep.json",
  ]);
  assert.deepEqual(
    importClosure("z.mjs", (path) => MODULES[path]),
    ["z.mjs"],
  );
  assert.throws(() => importClosure("gone.mjs", (path) => MODULES[path]));
  assert.throws(() =>
    importClosure("m.mjs", (path) => (path === "src/z.mjs" ? undefined : MODULES[path])),
  );
  const real = importClosure("auth-fs-cross/corpus.mjs", (path) =>
    readFileSync(join(CONFORMANCE_DIR, path), "utf8"),
  );
  assert.ok(real.includes("auth-fs-cross/programs.mjs") && real.includes("fs-rules/harness.mjs"));
});

const EXPORT_LANE = {
  files: ["a.mjs", "b.mjs"],
  extra: ({ exported }) => JSON.stringify(exported("m.mjs", "X")),
  fixture: "lane-production.json",
};
const TODAY_X = JSON.stringify({ n: 1 });
const todayInputs = {
  data: (path) => MODULES[path] ?? DATA,
  committed: (path) => MODULES[path] ?? DATA,
  exported: (module, name) => (module === "m.mjs" && name === "X" ? { n: 1 } : undefined),
};
const exportHop = (kind) => ({
  lane: "lane",
  from: rawDigest(EXPORT_LANE, (file) => TREES[REC][file], TODAY_X),
  to: scheme2Digest(EXPORT_LANE, (file) => TREES[kind === "scheme" ? REC : FIX][file], TODAY_X),
  commit: REC,
  kind,
  ...(kind === "unreached" ? { fix: FIX, condition: "no-failures" } : {}),
});
/** `changed` maps a revision to the files whose content differs there from this checkout's. */
const exportProblems = (hop, changed = {}, overrides = {}) =>
  lineageProblems(
    { version: 1, hops: [hop] },
    {
      lanes: { lane: EXPORT_LANE },
      reader: treesReader,
      dataReader: (commit) => (path) =>
        Object.hasOwn(changed[commit] ?? {}, path) ? changed[commit][path] : todayInputs.data(path),
      shallow: false,
      current: (file) => TREES[hop.kind === "scheme" ? REC : FIX][file],
      currentInputs: todayInputs,
      conditions: CONDITIONS,
      fixDelta: () => delta(),
      fixtureOf: () => ({ failures: [] }),
      ...overrides,
    },
  );

test("a hop's module exports count for its revision only when every source they come from is identical there", () => {
  for (const kind of ["scheme", "unreached"]) {
    assert.deepEqual(exportProblems(exportHop(kind)), [], kind);
    const revisions = kind === "scheme" ? [REC] : [REC, BASE, FIX];
    for (const commit of revisions)
      for (const file of CLOSURE) {
        const path = `src/${file}`;
        for (const there of [`${MODULES[path]}// edited\n`, undefined]) {
          const found = exportProblems(exportHop(kind), { [commit]: { [path]: there } });
          assert.equal(found.length, 1, `${kind} ${commit} ${file}`);
          assert.match(
            found[0],
            new RegExp(`${file.replace(".", "\\.")} is not the same at ${commit}`),
          );
        }
      }
    // A file the module does not come from may differ.
    assert.deepEqual(
      exportProblems(exportHop(kind), { [REC]: { "src/unrelated.mjs": "export const U = 2;\n" } }),
      [],
    );
  }
});

test("a module's closure is read from HEAD and the working tree must still hold HEAD's bytes", () => {
  const escaped = (file) => file.replace(".", "\\.");
  for (const kind of ["scheme", "unreached"]) {
    for (const file of CLOSURE) {
      const path = `src/${file}`;
      const worktreeOnly = exportProblems(
        exportHop(kind),
        {},
        {
          currentInputs: {
            ...todayInputs,
            data: (p) => (p === path ? `${MODULES[p]}// local\n` : todayInputs.data(p)),
          },
        },
      );
      assert.equal(worktreeOnly.length, 1, `${kind} ${file}`);
      assert.match(
        worktreeOnly[0],
        new RegExp(`${escaped(file)} differs between HEAD and the working tree`),
      );
      // The revision is compared with HEAD's bytes, not with the working tree's.
      const headOnly = exportProblems(
        exportHop(kind),
        {},
        {
          currentInputs: {
            ...todayInputs,
            committed: (p) => (p === path ? `${MODULES[p]}// head\n` : todayInputs.committed(p)),
          },
        },
      );
      assert.ok(headOnly.length >= 1, `${kind} ${file}`);
      assert.match(
        headOnly.join("\n"),
        new RegExp(`${escaped(file)} (is not the same at|differs between)`),
      );
    }
  }
});

test("a rewrite of a file a registered module export comes from is checked against HEAD", () => {
  if (isShallowCheckout()) return;
  const path = "conformance/src/auth-fs-cross/programs.mjs";
  const text = readFileSync(join(REPO_ROOT, path), "utf8");
  const found = rewriteReport({ [path]: `${text}// local\n` }).problems.join("\n");
  assert.match(
    found,
    /lineage after the rewrite: hop 0: .*programs\.mjs differs between HEAD and the working tree/,
  );
  assert.deepEqual(rewriteReport({ [path]: text }).problems, []);
  // A file no registered export comes from does not make a rewrite re-check the lineage.
  const unrelated = rewriteReport(
    { "conformance/src/auth-fs-cross/run.mjs": "// anything\n" },
    NO_GIT,
  );
  assert.ok(!unrelated.problems.some((problem) => /lineage after the rewrite/.test(problem)));
});

test("a JSON module a hop's export imports counts as bytes, identical or refused", () => {
  const modules = {
    "src/m.mjs": 'import dep from "./dep.json" with { type: "json" };\nexport const X = dep;\n',
    "src/dep.json": '{"n": 1}\n',
  };
  const inputs = {
    ...todayInputs,
    data: (p) => modules[p] ?? DATA,
    committed: (p) => modules[p] ?? DATA,
  };
  const run = (changed) =>
    exportProblems(exportHop("scheme"), changed, {
      currentInputs: inputs,
      dataReader: (commit) => (path) =>
        Object.hasOwn(changed[commit] ?? {}, path) ? changed[commit][path] : inputs.data(path),
    });
  assert.deepEqual(run({}), []);
  const found = run({ [REC]: { "src/dep.json": '{"n": 2}\n' } });
  assert.equal(found.length, 1);
  assert.match(found[0], /dep\.json is not the same at/);
  assert.match(
    run({ [REC]: { "src/dep.json": undefined } }).join("\n"),
    /dep\.json is not the same at/,
  );
});

test("a computed dynamic import in a module an export comes from refuses the hop", () => {
  const modules = {
    "src/m.mjs": 'const p = "./dep.mjs";\nexport const X = (await import(p)).X;\n',
  };
  const inputs = {
    ...todayInputs,
    data: (p) => modules[p] ?? DATA,
    committed: (p) => modules[p] ?? DATA,
  };
  const found = exportProblems(
    exportHop("scheme"),
    {},
    {
      currentInputs: inputs,
      dataReader: () => inputs.data,
    },
  );
  assert.equal(found.length, 1);
  assert.match(found[0], /computed specifier/);
});

test("the data a hop's digest reads is not a module source: it is the revision's own", () => {
  const found = exportProblems(exportHop("scheme"), {
    [REC]: { "src/m.mjs": "export const X = 1;\n" },
  });
  assert.equal(found.length, 1);
});

test("every export a lane reads is the module's own export in this checkout, by own name only", async () => {
  for (const [name, lane] of Object.entries(HARNESS_LANES)) {
    if (typeof lane.extra !== "function" || name === "auth-config-sdk") continue;
    const asked = [];
    extraOf(lane, {
      data: (path) => readFileSync(join(CONFORMANCE_DIR, path), "utf8"),
      exported: (module, exportName) => {
        asked.push([module, exportName]);
        return {};
      },
      sdkVersions: () => ({}),
    });
    for (const [module, exportName] of asked) {
      const imported = await import(`./${module}`);
      assert.deepEqual(
        extraOf({ extra: ({ exported }) => exported(module, exportName) }),
        imported[exportName],
        `${name} ${module}`,
      );
    }
  }
  const read = (module, name) => extraOf({ extra: ({ exported }) => exported(module, name) });
  for (const [module, name] of [
    ["auth-account/authorized-domains.mjs", "NOPE"],
    ["auth-account/authorized-domains.mjs", "toString"],
    ["auth-account/authorized-domains.mjs", "constructor"],
    ["no/such/module.mjs", "AUTHORIZED_DOMAINS"],
    ["toString", "AUTHORIZED_DOMAINS"],
    ["__proto__", "x"],
  ])
    assert.throws(() => read(module, name), /no export .* is registered/, `${module} ${name}`);
});

test("the installed SDK versions cannot be read at a revision, so such a lane's hop is refused", () => {
  const lane = { ...EXPORT_LANE, extra: ({ sdkVersions }) => JSON.stringify(sdkVersions()) };
  const found = lineageProblems(
    { version: 1, hops: [{ ...exportHop("scheme"), from: "9".repeat(64) }] },
    {
      lanes: { lane },
      reader: treesReader,
      dataReader: dataAt,
      shallow: false,
      current: (file) => TREES[REC][file],
      currentInputs: { sdkVersions: () => ({}) },
    },
  );
  assert.match(found.join("\n"), /installed SDK versions cannot be read at a revision/);
});

test("the committed auth-fs-cross scheme hop passes, and is refused when a source its principals come from differs", () => {
  if (isShallowCheckout()) return;
  const hop = loadLineage().hops.find((h) => h.kind === "scheme");
  const run = (dataReader) =>
    lineageProblems(
      { version: 1, hops: [hop] },
      { lanes: HARNESS_LANES, reader: gitReader, shallow: false, dataReader },
    );
  assert.deepEqual(run(gitDataReader), []);
  for (const file of importClosure("auth-fs-cross/corpus.mjs", (path) =>
    readFileSync(join(CONFORMANCE_DIR, path), "utf8"),
  )) {
    const found = run(
      (commit) => (path) =>
        path === `src/${file}` ? "export const edited = 1;\n" : gitDataReader(commit)(path),
    );
    assert.match(
      found.join("\n"),
      new RegExp(`${file.replace(".", "\\.")} is not the same at`),
      file,
    );
  }
});

// ---- the lane runner accepts a lineage digest only when the whole lineage verifies ---------------------

const RUNNER_LANE = { ...EXPORT_LANE, extra: DATA };
const RUNNER_HOP = () => ({
  ...exportHop("scheme"),
  from: "7".repeat(64),
  to: scheme2Digest(RUNNER_LANE, (f) => TREES[REC][f]),
});
const snapshotOf = (hops, problems) =>
  createLineageSnapshot(
    () => ({ version: 1, hops }),
    () => problems,
  );
const runnerState = (snapshot, saved = RUNNER_HOP().from) =>
  checkVerifiedFixtureDigest("lane", RUNNER_LANE, saved, {
    read: (f) => TREES[REC][f],
    snapshot,
  }).state;

test("a lineage digest counts for a lane runner only when the whole lineage file verifies", () => {
  assert.equal(runnerState(snapshotOf([RUNNER_HOP()], [])), "lineage");
  // Any problem leaves no hop, so every lineage-connected row is stale.
  assert.equal(runnerState(snapshotOf([RUNNER_HOP()], ["refused"])), "stale");
  // Other states are not the lineage's business.
  const none = snapshotOf([RUNNER_HOP()], ["refused"]);
  assert.equal(
    runnerState(
      none,
      rawDigest(RUNNER_LANE, (f) => TREES[REC][f]),
    ),
    "raw",
  );
  assert.equal(
    runnerState(
      none,
      scheme2Digest(RUNNER_LANE, (f) => TREES[REC][f]),
    ),
    "scheme2",
  );
  assert.equal(runnerState(none, "6".repeat(64)), "stale");
});

test("the runner reads the lineage once and does every lookup on the object it validated", () => {
  let reads = 0;
  let verifies = 0;
  const hop = RUNNER_HOP();
  const snapshot = createLineageSnapshot(
    () => {
      reads += 1;
      // Whatever a later read would give, the first one is the only one used.
      return reads === 1
        ? { version: 1, hops: [hop] }
        : { version: 2, hops: [{ ...hop, from: "5".repeat(64) }] };
    },
    () => ((verifies += 1), []),
  );
  assert.equal(runnerState(snapshot), "lineage");
  assert.equal(runnerState(snapshot), "lineage");
  assert.equal(runnerState(snapshot, "5".repeat(64)), "stale");
  assert.deepEqual([reads, verifies], [1, 1]);
  assert.strictEqual(snapshot(), snapshot());
});

test("a malformed hop or an unreadable lineage is a lineage problem for the runner, never a throw", () => {
  const real = loadLineage();
  for (const bad of [null, 7, "hop", [], undefined]) {
    const hops = [...real.hops, bad];
    assert.match(
      releaseLineageProblems({ ...real, hops }).join("\n"),
      /hop \d+: the hop is not an object/,
    );
    assert.match(
      rewriteReport(
        {
          "conformance/harness-lineage.json": JSON.stringify({
            ...real,
            hops: [...real.hops, bad ?? null],
          }),
        },
        NO_GIT,
      ).problems.join("\n"),
      /the hop is not an object/,
    );
  }
  const lane = HARNESS_LANES["fs-query-index"];
  const fixture = JSON.parse(readFileSync(join(CONFORMANCE_DIR, lane.fixture), "utf8"));
  const [saved] = recordedDigests("fs-query-index", fixture);
  const state = (snapshot) =>
    checkVerifiedFixtureDigest("fs-query-index", lane, saved, { snapshot }).state;
  const real2 = (hops) => createLineageSnapshot(() => ({ ...real, hops }));
  assert.equal(state(real2(real.hops)), "lineage");
  assert.equal(state(real2([...real.hops, null])), "stale");
  assert.equal(state(createLineageSnapshot(() => null)), "stale");
  assert.equal(state(createLineageSnapshot(() => ({ version: 1, hops: "no" }))), "stale");
  const unreadable = createLineageSnapshot(() => {
    throw new Error("no such file");
  });
  assert.equal(state(unreadable), "stale");
  assert.match(unreadable().problems.join("\n"), /cannot be checked: no such file/);
});

test("the runner's verification is the release verifier's: version, duplicates, other hops and a shallow clone", () => {
  if (isShallowCheckout()) return;
  const lane = HARNESS_LANES["fs-query-index"];
  const fixture = JSON.parse(readFileSync(join(CONFORMANCE_DIR, lane.fixture), "utf8"));
  const [saved] = recordedDigests("fs-query-index", fixture);
  const state = (lineage, options = {}) =>
    checkVerifiedFixtureDigest("fs-query-index", lane, saved, {
      snapshot: createLineageSnapshot(
        () => lineage,
        (l) => releaseLineageProblems(l, { shallow: false, ...options }),
      ),
    }).state;
  const real = loadLineage();
  assert.equal(checkVerifiedFixtureDigest("fs-query-index", lane, saved).state, "lineage");
  assert.equal(state(real), "lineage");
  assert.equal(state({ ...real, version: 2 }), "stale");
  const hop = real.hops.find((h) => h.lane === "fs-query-index");
  assert.equal(state({ ...real, hops: [...real.hops, hop] }), "stale");
  // Another hop the release verifier refuses makes the whole file refused, whatever connects this row.
  const bad = { ...real.hops.find((h) => h.lane === "fs-query-index-merge"), fix: "4".repeat(40) };
  assert.equal(
    state({ ...real, hops: real.hops.map((h) => (h.lane === bad.lane ? bad : h)) }),
    "stale",
  );
  assert.equal(
    state({
      ...real,
      hops: real.hops.map((h) => (h === hop ? { ...hop, fix: "4".repeat(40) } : h)),
    }),
    "stale",
  );
  assert.equal(state(real, { shallow: true }), "stale");
  // The endpoint lookup alone would have accepted a forged hop.
  const forged = real.hops.map((h) => (h === hop ? { ...hop, fix: "4".repeat(40) } : h));
  assert.equal(
    checkFixtureDigest("fs-query-index", lane, saved, { lineage: forged }).state,
    "lineage",
  );
});

test("the release verifier checks the whole lineage file: version, duplicates, every hop and a shallow clone", () => {
  if (isShallowCheckout()) return;
  const real = loadLineage();
  assert.deepEqual(releaseLineageProblems(), []);
  assert.deepEqual(releaseLineageProblems(real, { shallow: false }), []);
  assert.match(releaseLineageProblems({ ...real, version: 2 }).join("\n"), /not \{ version: 1/);
  assert.match(
    releaseLineageProblems({ ...real, hops: [...real.hops, real.hops[1]] }).join("\n"),
    /duplicate hop/,
  );
  // Every lane's hop is checked, not only the one a row is connected by.
  for (const lane of ["fs-query-index-merge8", "auth-fs-cross"]) {
    const hops = real.hops.map((hop) =>
      hop.lane === lane ? { ...hop, commit: "1".repeat(40) } : hop,
    );
    assert.match(releaseLineageProblems({ ...real, hops }).join("\n"), /are not readable/, lane);
  }
  assert.match(releaseLineageProblems(real, { shallow: true }).join("\n"), /shallow clone/);
  // With no lineage given it is the checked-in file.
  assert.match(releaseLineageProblems(undefined, { shallow: true }).join("\n"), /shallow clone/);
  // The git history is read through the reader it is given.
  assert.match(
    releaseLineageProblems(real, {
      reader: () => () => {
        throw new Error("no history");
      },
    }).join("\n"),
    /no history/,
  );
});

test("the corpus of a lane is looked up by its own name", () => {
  assert.ok(Object.keys(corpusOfLane("fs-data-write-list")).length > 0);
  for (const name of ["fs-query-index", "constructor", "toString", "__proto__"])
    assert.deepEqual(corpusOfLane(name), {}, name);
});

test("the registry's default verification for a lane runner is the release verifier, once per process", () => {
  const source = readFileSync(join(CONFORMANCE_DIR, "src/harness-registry.mjs"), "utf8");
  assert.match(source, /const lineageSnapshot = createLineageSnapshot\(\);/);
  assert.match(
    source,
    /export function createLineageSnapshot\(read = loadLineage, verify = releaseLineageProblems\)/,
  );
});

test("the lane runner asks for the verified state, never the endpoint lookup", () => {
  const source = readFileSync(join(CONFORMANCE_DIR, "src/fs-query-index/run.mjs"), "utf8");
  assert.match(source, /checkVerifiedFixtureDigest\(LANE\.id, enrolled, saved\)/);
  assert.doesNotMatch(source, /\bcheckFixtureDigest\b/);
});
