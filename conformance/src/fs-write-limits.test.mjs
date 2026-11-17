import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  admissionPacketRow,
  taskIdForMode,
  verifyProductionAdmission,
} from "./fs-data-write-admission.mjs";
import {
  prepareSandboxCorpus,
  attemptEstimateFor,
  bracketGroupCorpora,
  bracketRequestBound,
  completeBracketGroups,
  isSetMode,
  ownedMutationNamesForPrograms,
  prepareWriteLimitsCorpus,
  productionAdmissionPlan,
  remainingSandboxBudget,
  requireHistoricalUnknownHold,
  sandboxLedgerEntry,
  selectBracketRecipes,
} from "./fs-data-write-sandbox-run.mjs";
import { RECORDING_SETS, recordingSet } from "./fs-data-write-sandbox.mjs";
import {
  createUnaryRpcCounter,
  maskWriteResponseTimes,
  validateLiveStreamSubset,
  validateWriteStreamDeleteRecipe,
  writeStreamCleanupDeleteRequest,
  writeStreamDeleteFrame,
  writeStreamSeedRequest,
  writeStreamShrinkRequest,
} from "./firestore-probe/stream-session.mjs";

const corpus = await prepareWriteLimitsCorpus();
const { recordingCorpus } = selectBracketRecipes(corpus, "writelimits");
const set = recordingSet("writelimits");
const sha = (text) => createHash("sha256").update(text).digest("hex");

test("the set pins its recipes, owned names and request cap to the generator's corpus", () => {
  const bound = bracketRequestBound(recordingCorpus, "writelimits");
  assert.equal(bound.maxHttpRequests, set.httpCap);
  assert.equal(bound.maxHttpRequests, 122 + 1 + 70 + 1);
  assert.equal(bound.maxStreamFrames, 6);
  assert.equal(bound.maxUnaryRpcs, 18);
  assert.equal(set.queriedCollection, null);
  const derived = ownedMutationNamesForPrograms(recordingCorpus.restPrograms);
  assert.deepEqual([...new Set([...derived, ...set.streamOwnedNames])].toSorted(), [
    ...set.ownedNames,
  ]);
  assert.equal(set.streamOwnedNames.length, 3);
});

test("a recipe the set does not name, or a stream document it does not own, is refused", () => {
  const extra = structuredClone(recordingCorpus);
  extra.restPrograms.push({ ...extra.restPrograms[0], id: "writes/limits/other" });
  assert.throws(() => bracketRequestBound(extra, "writelimits"), /fixed bracket recipes|count/);
  const moved = structuredClone(recordingCorpus);
  moved.streamRecipes[0].documentName = moved.streamRecipes[1].documentName;
  assert.throws(() => bracketRequestBound(moved, "writelimits"), /owned cleanup names/);
});

test("freeze groups cover every program once; the gRPC recipes get their own group", () => {
  const groups = bracketGroupCorpora(recordingCorpus, "writelimits");
  const covered = groups.flatMap(({ corpus: part }) => part.restPrograms.map((p) => p.id));
  assert.deepEqual(covered.toSorted(), recordingCorpus.restPrograms.map((p) => p.id).toSorted());
  for (const { group, corpus: part } of groups) {
    if (group === "write-stream") {
      assert.equal(part.restPrograms.length, 0);
      assert.equal(part.streamRecipes.length, 3);
    } else {
      assert.deepEqual(part.streamRecipes, []);
      assert.ok(part.restPrograms.length > 0);
    }
  }
});

test("a group freezes only when the first attempt answered all of it", () => {
  const rest = Object.fromEntries(
    recordingCorpus.restPrograms.map((program) => [
      program.id,
      {
        steps: Object.fromEntries(
          program.steps.map((step) => [step.id, { status: 200, code: "OK", body: {} }]),
        ),
      },
    ]),
  );
  const stream = Object.fromEntries(
    recordingCorpus.streamRecipes.map((recipe) => [
      recipe.id,
      { status: { code: 0 }, events: [{ type: "end" }] },
    ]),
  );
  assert.deepEqual(completeBracketGroups(recordingCorpus, "writelimits", rest, stream).toSorted(), [
    "base64",
    "budget",
    "collection-group",
    "composite",
    "write-stream",
  ]);
  const broken = structuredClone(rest);
  delete broken["writes/limits/commit-budget/60x2"].steps.readback;
  assert.ok(
    !completeBracketGroups(recordingCorpus, "writelimits", broken, stream).includes("budget"),
  );
  assert.ok(
    !completeBracketGroups(recordingCorpus, "writelimits", rest, {}).includes("write-stream"),
  );
});

test("the mode charges its own task and a US$10 cap, not the FS-DATA-WRITE task", () => {
  assert.equal(taskIdForMode("writelimits"), "FS-WRITE-LIMITS-SANDBOX");
  assert.equal(taskIdForMode("bracket"), "FS-DATA-WRITE-SANDBOX");
  assert.ok(isSetMode("writelimits") && !isSetMode("partial"));
  assert.equal(attemptEstimateFor("writelimits"), 0.25);
  const old = [{ taskId: "FS-DATA-WRITE-SANDBOX", estimatedUsd: 34.5 }];
  assert.equal(remainingSandboxBudget(old, 0.5, "writelimits"), 10);
  assert.throws(() => remainingSandboxBudget(old, 0.5), /budget exceeded/);
  const own = [{ taskId: "FS-WRITE-LIMITS-SANDBOX", estimatedUsd: 9.6, attemptId: "a" }];
  assert.throws(() => remainingSandboxBudget(own, 0.5, "writelimits"), /budget exceeded/);
  assert.ok(remainingSandboxBudget(own, 0.4, "writelimits") >= 0);
  // Two attempts of the pinned estimate always fit the cap.
  assert.ok(attemptEstimateFor("writelimits") * 2 <= 10);
});

test("only the FS-DATA-WRITE task needs its historical unknown hold", () => {
  assert.equal(requireHistoricalUnknownHold([], "writelimits"), null);
  assert.throws(() => requireHistoricalUnknownHold([], "bracket"), /historical unknown hold/);
  assert.equal(
    sandboxLedgerEntry({
      gitSha: "a",
      corpusDigest: "b",
      requests: 1,
      outcome: "x",
      runDir: "r",
      mode: "writelimits",
    }).taskId,
    "FS-WRITE-LIMITS-SANDBOX",
  );
  assert.equal(
    sandboxLedgerEntry({ gitSha: "a", corpusDigest: "b", requests: 1, outcome: "x", runDir: "r" })
      .taskId,
    "FS-DATA-WRITE-SANDBOX",
  );
});

test("admission rows and checks bind the new task, so an old-task row cannot admit it", () => {
  const plan = productionAdmissionPlan("writelimits", {
    sourceCorpusDigest: sha("c"),
    recordingCorpus,
  });
  assert.equal(plan.mode, "writelimits");
  assert.equal(plan.attempts, 2);
  assert.equal(plan.bounds.maxUnaryRpcs, 18);
  const review = Buffer.from(
    [
      "verdict: APPROVE",
      "mode: writelimits",
      `nonce: ${"a".repeat(24)}`,
      `sourceCommit: ${"b".repeat(40)}`,
      `planSha256: ${"c".repeat(64)}`,
    ].join("\n"),
  );
  const pins = {
    mode: "writelimits",
    nonce: "a".repeat(24),
    sourceCommit: "b".repeat(40),
    planSha256: "c".repeat(64),
    reviewSha256: sha(review),
  };
  const row = admissionPacketRow(pins);
  assert.equal(row.taskId, "FS-WRITE-LIMITS-SANDBOX");
  const verify = (rows) =>
    verifyProductionAdmission({
      admission: pins,
      reviewBytes: review,
      gitHead: pins.sourceCommit,
      gitStatus: "",
      rows,
    });
  assert.equal(verify([row]).packetId, `fs-data-write-writelimits-${"a".repeat(24)}`);
  assert.throws(
    () => verify([{ ...row, taskId: "FS-DATA-WRITE-SANDBOX" }]),
    /one ledger packet reservation/,
  );
  assert.throws(() => verify([]), /one ledger packet reservation/);
});

const recipe = (count = 12_112) =>
  structuredClone(corpus.streamRecipes.find((r) => r.arrayCount === count));

test("the write-stream delete recipe validator accepts the three counts and refuses near misses", () => {
  for (const count of [12_112, 12_113, 12_122])
    assert.ok(validateWriteStreamDeleteRecipe(recipe(count)));
  const bad = [
    (r) => (r.arrayCount = 12_111),
    (r) => (r.id = "writes/limits/write-stream-delete/12113"),
    (r) => (r.maxFrames = 3),
    (r) => (r.maxUnaryRpcs = 7),
    (r) => (r.transport = "rest"),
    (r) => (r.action = "half-close-after-handshake"),
    (r) => (r.documentName = r.documentName.replace("fireemu-oracle-sbx", "other")),
    (r) => (r.documentName = r.documentName.replace("/d", "/dd")),
    (r) => (r.documentName = r.documentName.replace("wlstream12112", "wlstream12113")),
    (r) => (r.documentName = r.documentName.replace(/c\/d$/, "x/d")),
  ];
  for (const mutate of bad) {
    const r = recipe();
    mutate(r);
    assert.throws(
      () => validateWriteStreamDeleteRecipe(r),
      /unsupported write-stream delete recipe/,
    );
  }
});

test("the child's subset check takes the three recipes once each and nothing else", () => {
  assert.equal(validateLiveStreamSubset(corpus.streamRecipes).length, 3);
  assert.throws(() => validateLiveStreamSubset([recipe(), recipe()]), /subset/);
  assert.throws(
    () => validateLiveStreamSubset([{ ...recipe(), id: "writes/limits/write-stream-delete/1" }]),
    /unsupported/,
  );
});

test("the recipe's requests seed, delete on the stream, shrink and delete exactly its document", () => {
  const r = recipe(12_113);
  const seed = writeStreamSeedRequest(r);
  assert.equal(seed.writes.length, 1);
  assert.deepEqual(seed.writes[0].currentDocument, { exists: false });
  const values = seed.writes[0].update.fields.a.arrayValue.values;
  assert.equal(values.length, 12_113);
  assert.deepEqual(values.slice(0, 2), [{ integerValue: "0" }, { integerValue: "1" }]);
  assert.equal(values.at(-1).integerValue, "12112");
  assert.equal(seed.writes[0].update.name, r.documentName);
  const frame = writeStreamDeleteFrame(r, Buffer.from("t"));
  assert.deepEqual(frame, { streamToken: Buffer.from("t"), writes: [{ delete: r.documentName }] });
  const shrink = writeStreamShrinkRequest(r).writes[0];
  assert.equal(shrink.transform.fieldTransforms[0].removeAllFromArray.values.length, 1_024);
  assert.deepEqual(shrink.currentDocument, { exists: true });
  assert.equal(shrink.transform.document, r.documentName);
  assert.deepEqual(writeStreamCleanupDeleteRequest(r).writes, [{ delete: r.documentName }]);
  // After the shrink the array is 1,024 shorter, and under every recorded delete boundary.
  assert.ok(12_122 - 1_024 < 12_111);
});

test("the RPC counter refuses the seventh call before it is sent", () => {
  const counter = createUnaryRpcCounter();
  for (let call = 1; call <= 6; call += 1) assert.equal(counter.next(), call);
  assert.throws(() => counter.next(), /budget reached/);
  assert.equal(counter.used, 6);
});

test("write response instants are masked but their presence is kept", () => {
  assert.deepEqual(
    maskWriteResponseTimes({
      commitTime: { seconds: "1", nanos: 2 },
      writeResults: [{ updateTime: { seconds: "1" } }, { updateTime: null }],
    }),
    { commitTime: "timestamp", writeResults: [{ updateTime: "timestamp" }, { updateTime: null }] },
  );
  assert.deepEqual(maskWriteResponseTimes({ commitTime: null, writeResults: [] }), {
    commitTime: null,
    writeResults: [],
  });
});

test("the recording sets keep the older sets intact", () => {
  assert.deepEqual(Object.keys(RECORDING_SETS).toSorted(), ["bracket", "followup", "writelimits"]);
  assert.equal(RECORDING_SETS.bracket.httpCap, 55);
});

// ---- the strict-today content check ----

import { readFileSync } from "node:fs";

import { checkWriteLimitsLocal } from "./fs-write-limits-local-check.mjs";

const manifest = JSON.parse(
  readFileSync(new URL("./firestore-probe/write-limits-set.json", import.meta.url), "utf8"),
);

function goodRehearsal() {
  const rest = {};
  for (const program of recordingCorpus.restPrograms) {
    const write = program.steps[0];
    let status = 200;
    let message;
    const bytes = program.id.includes("/bytes-line-breaks/");
    const parts = program.id.split("/");
    const m = parts.at(-2);
    const c = parts.at(-1);
    if (bytes && m === "commit" && c !== "control") {
      status = 400;
      message =
        "Invalid value at 'writes[0].update.fields[0].value.bytes_value' (TYPE_BYTES), Base64 decoding failed";
    }
    const stored =
      { control: "QUJD", lf: "QUJDQUJD", crlf: "QUJDQUJD", "mime-76": "x".repeat(88) }[c] ?? "QUJD";
    const readback =
      status === 400
        ? { status: 200, code: "OK", body: [{ missing: "n" }] }
        : { status: 200, code: "OK", body: [{ found: { fields: { b: { bytesValue: stored } } } }] };
    rest[program.id] = {
      steps: {
        [write.id]:
          status === 200
            ? { status, code: "OK", body: {} }
            : { status, code: "INVALID_ARGUMENT", message },
        readback,
      },
    };
  }
  const stream = Object.fromEntries(
    recordingCorpus.streamRecipes.map((r) => [
      r.id,
      {
        sentFrames: 2,
        status: { code: 0 },
        events: [
          { type: "seed", status: { code: 0 } },
          { type: "data", value: { writeResults: [] } },
          { type: "data", value: { commitTime: "timestamp", writeResults: [{}] } },
          { type: "readback", found: false, arrayCount: 0 },
        ],
      },
    ]),
  );
  return { rest, stream };
}

test("the content check passes a faithful strict-today rehearsal", () => {
  const { rest, stream } = goodRehearsal();
  assert.deepEqual(checkWriteLimitsLocal(rest, stream, manifest), []);
});

test("the content check names each kind of drift, so a pass is not a count of ok", () => {
  const drift = (mutate) => {
    const { rest, stream } = goodRehearsal();
    mutate(rest, stream);
    return checkWriteLimitsLocal(rest, stream, manifest);
  };
  assert.match(
    drift((rest) => (rest["writes/limits/commit-budget/60x2"].steps.write.status = 400)).join("\n"),
    /commit-budget\/60x2: strict accepts the write today/,
  );
  assert.match(
    drift(
      (rest) =>
        (rest[
          "writes/limits/bytes-line-breaks/create/lf"
        ].steps.readback.body[0].found.fields.b.bytesValue = "QUJD"),
    ).join("\n"),
    /create\/lf: strict drops the LF/,
  );
  assert.match(
    drift(
      (rest) => (rest["writes/limits/bytes-line-breaks/commit/lf"].steps.write.status = 200),
    ).join("\n"),
    /commit\/lf: commit already refuses/,
  );
  assert.match(
    drift(
      (rest) =>
        (rest["writes/limits/composite-entry/heavy/5530"].steps.readback.body = [{ missing: "x" }]),
    ).join("\n"),
    /5530: every written document reads back/,
  );
  assert.match(
    drift(
      (_, stream) => (stream["writes/limits/write-stream-delete/12113"].events[3].found = true),
    ).join("\n"),
    /12113: strict deleted the document/,
  );
  assert.match(
    drift(
      (_, stream) =>
        (stream["writes/limits/write-stream-delete/12112"].events[2].value.commitTime = {
          seconds: "1",
        }),
    ).join("\n"),
    /commit time is masked/,
  );
  assert.match(
    drift((rest) => delete rest["writes/limits/commit-budget/40x2"].steps.readback).join("\n"),
    /two answered steps/,
  );
});

test("a fully consistent recipe at an unrecorded count is still refused", () => {
  for (const count of [12_111, 12_121, 12_123, 12_124]) {
    const r = recipe();
    r.arrayCount = count;
    r.id = `writes/limits/write-stream-delete/${count}`;
    r.documentName = r.documentName.replace("wlstream12112", `wlstream${count}`);
    assert.equal(r.documentName.split("/documents/")[1].length, 1_000, "the name keeps its length");
    assert.throws(
      () => validateWriteStreamDeleteRecipe(r),
      /unsupported write-stream delete recipe/,
    );
  }
});

test("the older sets keep their plan shape: no unary-RPC bound unless a recipe sends one", async () => {
  const old = (await prepareSandboxCorpus()).corpus;
  const { recordingCorpus: bracket } = selectBracketRecipes(old, "bracket");
  assert.equal(Object.hasOwn(bracketRequestBound(bracket, "bracket"), "maxUnaryRpcs"), false);
  const { recordingCorpus: followup } = selectBracketRecipes(old, "followup");
  assert.equal(Object.hasOwn(bracketRequestBound(followup, "followup"), "maxUnaryRpcs"), false);
});

test("an attempt reservation counts only under the new task for the new mode", () => {
  const review = Buffer.from(
    [
      "verdict: APPROVE",
      "mode: writelimits",
      `nonce: ${"a".repeat(24)}`,
      `sourceCommit: ${"b".repeat(40)}`,
      `planSha256: ${"c".repeat(64)}`,
    ].join("\n"),
  );
  const pins = {
    mode: "writelimits",
    nonce: "a".repeat(24),
    sourceCommit: "b".repeat(40),
    planSha256: "c".repeat(64),
    reviewSha256: sha(review),
  };
  const packet = admissionPacketRow(pins);
  const runId = "d".repeat(32);
  const attempt = (taskId) => ({ taskId, outcome: "reserved", packetId: packet.packetId, runId });
  const verify = (rows) =>
    verifyProductionAdmission({
      admission: pins,
      reviewBytes: review,
      gitHead: pins.sourceCommit,
      gitStatus: "",
      rows,
      runId,
    });
  assert.ok(verify([packet, attempt("FS-WRITE-LIMITS-SANDBOX")]).attempt);
  assert.throws(() => verify([packet, attempt("FS-DATA-WRITE-SANDBOX")]), /attempt reservation/);
});
