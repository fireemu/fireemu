// The REMOTE-CONFIG closure record's stage-A conditions (RC-CLOSURE-A): each VERIFIED condition
// cites both production passes, and its counts are recomputed from the committed comparisons,
// which the evidence check recomputes from the pinned fixtures.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COMPARISONS,
  CONDITION_ROWS,
  FILES,
  KNOWN,
  PINS,
  conditionCounts,
  conditionOf,
  verifyEvidence,
} from "./remote-config-closure/evidence.mjs";
import { gitReaders } from "./remote-config-production/evidence.mjs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const record = JSON.parse(read("spec/compatibility/closure/REMOTE-CONFIG.json"));
const documents = Object.fromEntries(
  COMPARISONS.map(([key]) => [key, JSON.parse(read(FILES[key]))]),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const STAGE_A = Object.keys(CONDITION_ROWS);

test("the committed closure evidence of HEAD is valid", () => {
  assert.deepEqual(verifyEvidence(gitReaders()), []);
});

test("the parent stays in progress: six stage-A conditions VERIFIED, fetch and realtime planned", () => {
  assert.equal(record.parentStatus, "IN_PROGRESS");
  const status = Object.fromEntries(record.conditions.map((c) => [c.conditionId, c.status]));
  for (const id of STAGE_A) assert.equal(status[id], "VERIFIED", id);
  assert.equal(status["REMOTE-CONFIG/client-fetch-and-activate"], "PLANNED");
  assert.equal(status["REMOTE-CONFIG/realtime-updates"], "PLANNED");
  assert.equal(record.conditions.length, 8);
});

test("every comparison row belongs to exactly one stage-A condition", () => {
  for (const [key, document] of Object.entries(documents))
    for (const row of document.rows) assert.ok(conditionOf(row.id), `${key}: ${row.id}`);
});

test("each VERIFIED condition cites both passes and its recomputed counts", () => {
  const evidence = record.closureEvidence;
  assert.deepEqual(evidence.recordingPolicy, {
    observedPasses: 2,
    requiredPasses: 2,
    waiver: null,
  });
  assert.equal(evidence.knownDifferencesPath, KNOWN);
  assert.equal(evidence.knownDifferencesSha256, PINS[KNOWN]);
  for (const entry of [...evidence.recordings, ...evidence.localRuns])
    assert.equal(entry.fixtureSha256, PINS[entry.fixturePath], entry.fixturePath);
  for (const entry of evidence.comparisons) {
    assert.equal(entry.comparisonPath, FILES[entry.name]);
    assert.equal(entry.comparisonSha256, PINS[entry.comparisonPath]);
    assert.equal(sha(read(entry.comparisonPath)), entry.comparisonSha256);
  }
  for (const condition of record.conditions.filter((c) => c.status === "VERIFIED")) {
    const id = condition.conditionId;
    assert.ok(STAGE_A.includes(id), id);
    assert.deepEqual(
      condition.productionEvidence.map((e) => [e.alias, e.fixturePath, e.fixtureSha256]),
      [
        ["pass-1", FILES.pass1, PINS[FILES.pass1]],
        ["pass-2", FILES.pass2, PINS[FILES.pass2]],
      ],
      id,
    );
    assert.equal(condition.observedPasses, 2, id);
    const expected = Object.fromEntries(
      ["runVsRun", "strictVsPass1", "strictVsPass2"].map((key) => [
        key,
        conditionCounts(documents[key], id),
      ]),
    );
    assert.deepEqual(condition.comparisons, expected, id);
    // A verified condition has rows, and neither a mismatch nor an unknown row in the strict
    // comparisons or between the two passes.
    for (const [key, { rows, counts }] of Object.entries(expected)) {
      assert.ok(rows > 0, `${id} ${key}`);
      assert.equal(counts.MISMATCH + counts.UNKNOWN, 0, `${id} ${key}`);
    }
    assert.equal(
      condition.passComparison,
      expected.runVsRun.counts.KNOWN_DIFFERENCE ? "KNOWN_DIFFERENCE" : "MATCH",
      id,
    );
    // The known differences it names are exactly the ones its rows use.
    const used = new Set();
    for (const key of ["runVsRun", "strictVsPass1", "strictVsPass2"])
      for (const row of documents[key].rows)
        if (conditionOf(row.id) === id) for (const kd of row.knownDifferences) used.add(kd);
    assert.deepEqual(condition.knownDifferences.toSorted(), [...used].toSorted(), id);
    assert.deepEqual(condition.profiles, {
      strict: "MATCHES_RECORDED_CASES",
      emulator: "NO_PRODUCTION_CLAIM",
    });
  }
});

test("the emulator comparisons differ exactly by the refusals only strict makes", () => {
  // 24 validations production refused with 400 that the emulator profile accepts (200), each a
  // strict MATCH, and the four server reads and writes that carry the four accepted server
  // conditions (coordinator ruling 12, Should 6).
  const fixture = (key) => JSON.parse(read(FILES[key]));
  const status = (key) => new Map(fixture(key).rows.map((row) => [row.case, row.status]));
  const carriers = ["s1-publish", "s2-data-plane", "s3-server-admin", "s4-wildcard"];
  for (const [key, pass, strict] of [
    ["emulatorVsPass1", "pass1", "strictVsPass1"],
    ["emulatorVsPass2", "pass2", "strictVsPass2"],
  ]) {
    const production = status(pass);
    const emulator = status("localEmulator");
    const strictRows = new Map(documents[strict].rows.map((row) => [row.id, row.status]));
    const mismatches = documents[key].rows
      .filter((row) => row.status === "MISMATCH")
      .map((r) => r.id);
    assert.equal(mismatches.length, 28, key);
    const refusals = mismatches.filter((id) => !carriers.includes(id));
    assert.equal(refusals.length, 24, key);
    for (const id of refusals) {
      assert.ok(id.startsWith("v-cond-") || /^s-validate-2[0-3]$/.test(id), `${key}: ${id}`);
      assert.equal(production.get(id), 400, `${key}: ${id}`);
      assert.equal(emulator.get(id), 200, `${key}: ${id}`);
      assert.equal(strictRows.get(id), "MATCH", `${key}: ${id}`);
    }
    assert.deepEqual(
      mismatches.filter((id) => carriers.includes(id)),
      carriers,
      key,
    );
    for (const id of carriers) assert.notEqual(strictRows.get(id), "MISMATCH", `${key}: ${id}`);
    assert.equal(documents[key].counts.UNKNOWN, 0, key);
  }
});
