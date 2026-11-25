import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { gitReaders } from "../remote-config-production/evidence.mjs";
import {
  CASES,
  COMPARISONS,
  CONDITION_ROWS,
  DIR,
  FILES,
  KNOWN,
  PINS,
  RECORD_LOCK,
  TRUST_INPUTS,
  comparison,
  conditionCounts,
  conditionOf,
  corpusNumber,
  verifyEvidence,
} from "./evidence.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (bytes) => JSON.parse(bytes);
const bytesOf = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

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

const pinsOf = (files) =>
  Object.fromEntries(Object.keys(PINS).map((path) => [path, sha256(files[path])]));

/** A forger who rewrites one input, recomputes every comparison, every pin and the record lock. */
function reforge(files, path, change) {
  const out = { ...files };
  const value = json(out[path]);
  change(value);
  out[path] = bytesOf(value);
  for (const [key, left, right, kind, profile] of COMPARISONS)
    out[FILES[key]] = bytesOf(
      comparison({
        kind,
        profile,
        left: { bytes: out[FILES[left]] },
        right: { bytes: out[FILES[right]] },
        known: { bytes: out[KNOWN] },
      }),
    );
  const pins = pinsOf(out);
  const lock = json(out[RECORD_LOCK]);
  lock.records[FILES.pass1] = pins[FILES.pass1];
  lock.records[FILES.pass2] = pins[FILES.pass2];
  out[RECORD_LOCK] = bytesOf(lock);
  return { files: out, pins };
}

const check = (forged) => verifyEvidence({ ...readers(forged.files), pins: forged.pins });

test("the committed closure evidence of HEAD is valid when read from git objects", () => {
  assert.deepEqual(verifyEvidence(gitReaders("HEAD", ROOT)), []);
});

test("the pins are a closed table of the evidence directory and the known differences", () => {
  assert.deepEqual(Object.keys(PINS).toSorted(), TRUST_INPUTS);
  const files = headFiles();
  const { [FILES.emulatorVsPass2]: _dropped, ...fewer } = PINS;
  assert.match(verifyEvidence({ ...readers(files), pins: fewer })[0], /trust table/);
  const extra = { ...files, [`${DIR}/extra.json`]: Buffer.from("{}\n") };
  assert.ok(verifyEvidence(readers(extra)).includes(`${DIR}/extra.json: not pinned`));
  const { [FILES.pass2]: _missing, ...absent } = files;
  assert.ok(verifyEvidence(readers(absent)).includes(`${FILES.pass2}: pinned but absent`));
});

test("forgery: altered bytes fail their pin; a re-pinned pass is refused by the record lock", () => {
  const files = headFiles();
  const altered = { ...files, [FILES.pass1]: Buffer.from(files[FILES.pass1].toString() + " ") };
  assert.ok(
    verifyEvidence(readers(altered)).includes(`${FILES.pass1}: sha256 differs from its pin`),
  );
  const pins = { ...PINS, [FILES.pass1]: sha256(altered[FILES.pass1]) };
  assert.ok(
    verifyEvidence({ ...readers(altered), pins }).includes(
      `${FILES.pass1}: its pin differs from ${RECORD_LOCK}`,
    ),
  );
});

test("forgery: a comparison that is not the recomputed one", () => {
  const files = headFiles();
  for (const [key] of COMPARISONS) {
    const value = json(files[FILES[key]]);
    value.rows[0].status = value.rows[0].status === "MATCH" ? "MISMATCH" : "MATCH";
    const forged = { ...files, [FILES[key]]: bytesOf(value) };
    const pins = { ...PINS, [FILES[key]]: sha256(forged[FILES[key]]) };
    assert.ok(
      verifyEvidence({ ...readers(forged), pins }).includes(
        `${FILES[key]}: differs from the recomputed comparison`,
      ),
      key,
    );
  }
});

test("forgery: a widened known-difference rule is refused even with every pin recomputed", () => {
  const forged = reforge(headFiles(), KNOWN, (known) => {
    known.entries[0].fieldSuffixes.push(":value");
  });
  assert.ok(check(forged).includes(`${KNOWN}: the rules differ from the pinned rules`));
  const scope = reforge(headFiles(), KNOWN, (known) => {
    known.entries[1].appliesTo.push("production-vs-local");
  });
  assert.ok(check(scope).includes(`${KNOWN}: the rules differ from the pinned rules`));
});

test("forgery: a fixture with another case list, an open item or a private value", () => {
  const files = headFiles();
  const dropped = reforge(files, FILES.pass2, (fixture) => fixture.rows.pop());
  assert.ok(check(dropped).includes(`${FILES.pass2}: the rows are not the cases of the plan`));
  const open = reforge(files, FILES.pass1, (fixture) => fixture.open.push("x"));
  assert.ok(check(open).includes(`${FILES.pass1}: the run left open items`));
  const number = reforge(files, FILES.pass1, (fixture) => {
    fixture.rows[0].text = "123456789012";
  });
  assert.ok(check(number).includes(`${FILES.pass1}: a number of 11 or more digits`));
  const tag = reforge(files, FILES.localStrict, (fixture) => {
    fixture.rows[0].etag = "etag-123456789012-3";
  });
  assert.ok(check(tag).includes(`${FILES.localStrict}: a numeric ETag`));
  // The recomputed comparisons alone never make a forged fixture valid.
  assert.notDeepEqual(check(open), []);
});

test("corpusNumber admits only the corpus's own long digit runs", () => {
  assert.ok(corpusNumber("9223372036854775807"));
  assert.ok(corpusNumber("000000000000000000049"));
  assert.ok(corpusNumber("000000000000000000000"));
  for (const digits of [
    "9223372036854775806",
    "000000000123456789012",
    "123456789012",
    "100000000000000000000",
  ])
    assert.equal(corpusNumber(digits), false, digits);
});

test("conditions own the rows: one owner each, and counts by condition", () => {
  assert.equal(conditionOf("a-client"), "REMOTE-CONFIG/template-read");
  assert.equal(conditionOf("g-server"), "REMOTE-CONFIG/template-read");
  assert.equal(conditionOf("v-cond-negation"), "REMOTE-CONFIG/template-validation");
  assert.equal(conditionOf("p7-race"), "REMOTE-CONFIG/template-publish");
  assert.equal(conditionOf("c9-restore"), "REMOTE-CONFIG/version-history-and-rollback");
  assert.equal(conditionOf("k2-rollback-unknown"), "REMOTE-CONFIG/version-history-and-rollback");
  assert.equal(conditionOf("s7-history"), "REMOTE-CONFIG/server-template-evaluation");
  assert.equal(conditionOf("s-validate-00"), "REMOTE-CONFIG/server-template-evaluation");
  assert.equal(conditionOf("summary:g1"), "REMOTE-CONFIG/publish-trigger");
  assert.equal(conditionOf("event-ids"), "REMOTE-CONFIG/publish-trigger");
  assert.equal(conditionOf("x-unknown"), null);
  for (const id of CASES) assert.ok(conditionOf(id), id);
  const document = {
    rows: [
      { id: "r-identity", status: "MATCH" },
      { id: "r-number", status: "KNOWN_DIFFERENCE" },
      { id: "v-empty", status: "MISMATCH" },
    ],
  };
  assert.deepEqual(conditionCounts(document, "REMOTE-CONFIG/template-read"), {
    rows: 2,
    counts: { MATCH: 1, MATCH_LAYOUT: 0, KNOWN_DIFFERENCE: 1, MISMATCH: 0, UNKNOWN: 0 },
  });
  assert.equal(Object.keys(CONDITION_ROWS).length, 6);
});
