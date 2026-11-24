import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CASES,
  DIR,
  FILES,
  KNOWN,
  PINS,
  RECORD_LOCK,
  TRUST_INPUTS,
  comparison,
  fixtureProblems,
  gitReaders,
  verifyEvidence,
} from "./evidence.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = fileURLToPath(new URL("./evidence.mjs", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The pinned files as committed at HEAD, as an in-memory revision. */
function headFiles() {
  const { read } = gitReaders("HEAD", ROOT);
  return Object.fromEntries([...Object.keys(PINS), RECORD_LOCK].map((path) => [path, read(path)]));
}

function readers(files) {
  return {
    list: (dir) =>
      Object.keys(files)
        .filter((path) => dirname(path) === dir)
        .map((path) => path.slice(dir.length + 1)),
    read: (path) => files[path] ?? null,
  };
}

const json = (bytes) => JSON.parse(bytes);
const bytesOf = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const pinsOf = (files) =>
  Object.fromEntries(Object.keys(PINS).map((path) => [path, sha256(files[path])]));

/** A forger who rewrites one fixture, recomputes both comparisons and every pin. */
function reforge(files, path, change) {
  const out = { ...files };
  const value = json(out[path]);
  change(value);
  out[path] = bytesOf(value);
  for (const [profile, local, target] of [
    ["strict", FILES.localStrict, FILES.strict],
    ["emulator", FILES.localEmulator, FILES.emulator],
  ])
    out[target] = bytesOf(
      comparison({
        profile,
        production: { bytes: out[FILES.production] },
        local: { bytes: out[local] },
        known: { bytes: out[KNOWN] },
      }),
    );
  return { files: out, pins: pinsOf(out) };
}

/** The same forger, who can also rewrite the closure record lock. */
function reforgeWithLock(files, path, change) {
  const forged = reforge(files, path, change);
  const lock = json(forged.files[RECORD_LOCK]);
  lock.records[FILES.production] = forged.pins[FILES.production];
  forged.files[RECORD_LOCK] = bytesOf(lock);
  return forged;
}

test("the committed evidence of HEAD is valid when read from git objects", () => {
  assert.deepEqual(verifyEvidence(gitReaders("HEAD", ROOT)), []);
});

test("the pins are a closed table of the evidence directory and the known differences", () => {
  assert.deepEqual(Object.keys(PINS).toSorted(), [...Object.values(FILES), KNOWN].toSorted());
  for (const digest of Object.values(PINS)) assert.match(digest, /^[0-9a-f]{64}$/);
  const files = headFiles();
  assert.deepEqual(verifyEvidence(readers(files)), []);
});

test("forgery: an extra file and a missing file in the evidence directory", () => {
  const files = headFiles();
  assert.deepEqual(
    verifyEvidence(readers({ ...files, [`${DIR}/extra.json`]: Buffer.from("{}") })),
    [`${DIR}/extra.json: not pinned`],
  );
  const missing = { ...files };
  delete missing[FILES.emulator];
  assert.deepEqual(verifyEvidence(readers(missing)), [
    `${FILES.emulator}: pinned but absent`,
    `${FILES.emulator}: unreadable`,
  ]);
  const known = { ...files };
  delete known[KNOWN];
  assert.deepEqual(verifyEvidence(readers(known)), [`${KNOWN}: unreadable`]);
});

test("forgery: altered bytes with the same shape fail their pin", () => {
  const files = headFiles();
  const text = files[FILES.production].toString("utf8");
  const at = text.indexOf('"status": 200');
  const altered = Buffer.from(text.slice(0, at) + '"status": 201' + text.slice(at + 13));
  assert.equal(altered.length, files[FILES.production].length);
  assert.deepEqual(verifyEvidence(readers({ ...files, [FILES.production]: altered })), [
    `${FILES.production}: sha256 differs from its pin`,
  ]);
});

test("forgery: re-pinned files still have to be complete, answered, sanitised and the plan's cases", () => {
  const files = headFiles();
  const cases = [
    [
      (f) => void (f.rows[3] = { ...f.rows[3], phase: "unknown", status: undefined }),
      /s-validate-00 is not an answered row/,
    ],
    [
      (f) => void f.rows.push({ ...f.rows[0], case: "extra" }),
      /the rows are not the cases of the plan/,
    ],
    [(f) => void f.rows.pop(), /the rows are not the cases of the plan/],
    [(f) => void (f.complete = false), /the run was not complete/],
    [(f) => void f.open.push("x"), /the run left open items/],
    [(f) => void (f.rows[0].etag = "etag-123456789012-27"), /a numeric ETag/],
    [(f) => void (f.rows[0].body.note = "owner@corp.example.org"), /an e-mail address/],
    [
      (f) => void (f.rows[0].path = "/v1/projects/real-project/remoteConfig"),
      /a project id other than PROJECT_ID/,
    ],
    [(f) => void (f.target = "local"), /target is not production/],
    [(f) => void (f.kind = "other"), /wrong kind/],
    [(f) => void (f.rows[3].phase = "unknown"), /s-validate-00 is not an answered row/],
    [(f) => void (f.rows[0].body.note = "12345678901"), /a number of 11 or more digits/],
  ];
  for (const [change, message] of cases) {
    const forged = reforgeWithLock(files, FILES.production, change);
    const problems = verifyEvidence({ ...readers(forged.files), pins: forged.pins });
    assert.ok(
      problems.some((p) => message.test(p)),
      `${message}: ${problems.join("; ")}`,
    );
  }
});

test("forgery: each re-pinned local fixture is checked as well", () => {
  const files = headFiles();
  for (const path of [FILES.localStrict, FILES.localEmulator]) {
    const forged = reforge(files, path, (f) => void (f.complete = false));
    assert.deepEqual(verifyEvidence({ ...readers(forged.files), pins: forged.pins }), [
      `${path}: the run was not complete`,
    ]);
  }
});

test("forgery: a re-pinned comparison that is not the recomputed one", () => {
  const files = headFiles();
  const forged = { ...files };
  const document = json(forged[FILES.strict]);
  document.counts.MATCH += 1;
  document.counts.MISMATCH -= 1;
  forged[FILES.strict] = bytesOf(document);
  assert.deepEqual(verifyEvidence({ ...readers(forged), pins: pinsOf(forged) }), [
    `${FILES.strict}: differs from the recomputed comparison`,
  ]);
  const known = {
    ...files,
    [KNOWN]: Buffer.from(JSON.stringify({ schemaVersion: 1, entries: [] })),
  };
  assert.deepEqual(verifyEvidence({ ...readers(known), pins: pinsOf(known) }), [
    `${KNOWN}: the entries are not KD-MEMBER-ORDER`,
    `${FILES.strict}: differs from the recomputed comparison`,
    `${FILES.emulator}: differs from the recomputed comparison`,
  ]);
});

test("fixtureProblems refuses text that is not JSON", () => {
  assert.deepEqual(fixtureProblems("x", Buffer.from("{"), "production"), ["x: not JSON"]);
  assert.equal(CASES.length, 42);
});

// The runner: the same checks through the command line, on a revision of a scratch repository.
test("runner: check accepts the committed revision and refuses each forged one", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "rc-evidence-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      ...args,
    ]);
  git("init", "-q");
  const commit = (files, label) => {
    rmSync(join(repo, "conformance"), { recursive: true, force: true });
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), bytes);
    }
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", label);
    return git("rev-parse", "HEAD").toString().trim();
  };
  const check = (rev) =>
    spawnSync(process.execPath, [CLI, "check", "--repo", repo, "--rev", rev], { encoding: "utf8" });
  const files = headFiles();
  const good = check(commit(files, "good"));
  assert.equal(good.status, 0, good.stderr);
  const text = files[FILES.production].toString("utf8");
  const at = text.indexOf('"status": 200');
  const forgeries = {
    extra: [{ ...files, [`${DIR}/extra.json`]: Buffer.from("{}") }, /extra\.json: not pinned/],
    missing: [
      Object.fromEntries(Object.entries(files).filter(([p]) => p !== FILES.localStrict)),
      /pinned but absent/,
    ],
    altered: [
      {
        ...files,
        [FILES.production]: Buffer.from(text.slice(0, at) + '"status": 201' + text.slice(at + 13)),
      },
      /sha256 differs/,
    ],
    "error row": [
      reforge(files, FILES.production, (f) => void (f.rows[3].phase = "unknown")).files,
      /sha256 differs/,
    ],
  };
  for (const [label, [forged, message]] of Object.entries(forgeries)) {
    const result = check(commit(forged, label));
    assert.equal(result.status, 1, label);
    assert.match(result.stderr, message, label);
  }
});

test("the committed comparisons carry the digests of their inputs", () => {
  for (const path of [FILES.strict, FILES.emulator]) {
    const document = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
    assert.equal(document.inputs.production, PINS[FILES.production]);
    assert.equal(document.inputs.knownDifferences, PINS[KNOWN]);
    assert.equal(
      document.inputs.local,
      PINS[path === FILES.strict ? FILES.localStrict : FILES.localEmulator],
    );
  }
});

// Coordinator ruling 3 (2026-11-24, review of 9bf6af99f).
test("a re-pinned production fixture is refused by the record lock outside this module", () => {
  const files = headFiles();
  const forged = reforge(files, FILES.production, (f) => {
    const row = f.rows.find((r) => r.case === "s-validate-20");
    row.body.error.message = `X${row.body.error.message.slice(1)}`;
  });
  assert.deepEqual(verifyEvidence({ ...readers(forged.files), pins: forged.pins }), [
    `${FILES.production}: its pin differs from ${RECORD_LOCK}`,
  ]);
  const lock = JSON.parse(files[RECORD_LOCK]);
  assert.equal(lock.records[FILES.production], PINS[FILES.production]);
});

test("the closed table refuses a seventh pinned input and a changed list of known differences", () => {
  assert.deepEqual(TRUST_INPUTS, Object.keys(PINS).toSorted());
  assert.equal(TRUST_INPUTS.length, 6);
  const files = headFiles();
  const seventh = { ...files, [`${DIR}/extra.json`]: Buffer.from("{}") };
  const problems = verifyEvidence({
    ...readers(seventh),
    pins: { ...pinsOf(seventh), [`${DIR}/extra.json`]: sha256(Buffer.from("{}")) },
  });
  assert.match(problems[0], /the pins are not the trust table's inputs/);
  const emptied = {
    ...files,
    [KNOWN]: Buffer.from(JSON.stringify({ schemaVersion: 1, entries: [] })),
  };
  const recomputed = reforge(emptied, FILES.localStrict, () => {});
  assert.ok(
    verifyEvidence({ ...readers(recomputed.files), pins: recomputed.pins }).includes(
      `${KNOWN}: the entries are not KD-MEMBER-ORDER`,
    ),
  );
});

test("fixtureProblems refuses private values in encoded forms", () => {
  const fixture = JSON.parse(headFiles()[FILES.production]);
  for (const [value, problem] of [
    ["MTIzNDU2Nzg5MDEy", /a number of 11 or more digits/],
    ["%31%32%33%34%35%36%37%38%39%30%31%32", /a number of 11 or more digits/],
    ["owner%40corp.example.org", /an e-mail address/],
    ["etag-1234-1", /a numeric ETag/],
    [Buffer.from("projects/real-project/x").toString("base64"), /a project id other than/],
  ]) {
    const forged = structuredClone(fixture);
    forged.rows[0].body.note = value;
    const problems = fixtureProblems("x", Buffer.from(JSON.stringify(forged)), "production");
    assert.ok(
      problems.some((p) => problem.test(p)),
      `${value}: ${problems.join("; ")}`,
    );
  }
  assert.deepEqual(fixtureProblems("x", headFiles()[FILES.production], "production"), []);
});
