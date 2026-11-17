import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  admissionPacketRow,
  taskIdForMode,
  verifyProductionAdmission,
} from "./fs-data-write-admission.mjs";
import {
  bracketGatePins,
  ownerRowParent,
  recordBracketProduction,
  prepareSandboxCorpus,
  requireBracketArguments,
  verifyBracketSendGates,
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
import {
  compareRecordings,
  compareSandboxArtifact,
  RECORDING_SETS,
  recordingSet,
} from "./fs-data-write-sandbox.mjs";
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

// ---- the provider-state refusal and the owner row ----

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkProviderStateFiles,
  expectedComposites,
  expectedProviderState,
  GCLOUD_COMMANDS,
  providerStateDigest,
  providerStateProblems,
} from "./fs-write-limits-provider-state.mjs";

const DB = "projects/fireemu-oracle-sbx/databases/(default)";
const committedIndexes = JSON.parse(
  readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"),
).indexes;

// Bodies copied from the recorded production runs (conformance/fs-config-lifecycle-production.json),
// with only their names re-pointed at the sandbox database. Production omits
// `usesAncestorConfig` on an explicit override and sets it to true on an inherited field.
const recordedPrograms = JSON.parse(
  readFileSync(new URL("../fs-config-lifecycle-production.json", import.meta.url), "utf8"),
).programs;
const recordedExemption = recordedPrograms["fs-config/field/index-config/exemption"].steps;
const repointed = (value, replacements = []) => {
  let text = JSON.stringify(value).replaceAll("projects/demo-fs-config/databases/<db:a>", DB);
  for (const [from, to] of replacements) text = text.replaceAll(from, to);
  return JSON.parse(text);
};
// A COLLECTION_GROUP-only override: the shape of `items/n`.
const overrideCollectionGroupOnly = () =>
  repointed(recordedExemption["get-collection-group-only"].body, [
    ["/fields/cg", "/fields/n"],
    ['"fieldPath":"cg"', '"fieldPath":"n"'],
  ]);
// An exempted field: an override with no `indexes` at all.
const overrideExempted = (group, field) =>
  repointed(recordedExemption["exempted"].settled.body, [
    ["/items/fields/nx", `/${group}/fields/${field}`],
  ]);
// An inherited field and a TTL-only field, both `usesAncestorConfig: true`.
const inheritedField = (group, field) =>
  repointed(recordedExemption["get-inherited"].body, [
    ["/items/fields/nx", `/${group}/fields/${field}`],
    ['"fieldPath":"nx"', `"fieldPath":"${field}"`],
  ]);
const ttlOnlyField = () =>
  repointed(recordedPrograms["fs-config/field/ttl/policy"].steps["list-ttl"].body.fields[0]);
const recordedDatabase = () =>
  repointed(recordedPrograms["fs-config/database/create/basic"].steps.create.body.response, [
    [`${DB}`, DB],
  ]);
const recordedIndexKeys = () => {
  const step = recordedPrograms["fs-config/default-database/lifecycle"].steps["index-ready"];
  return Object.keys(step.trace.at(-1).body).toSorted();
};

function goodObservation() {
  return {
    composite: committedIndexes.map((index, number) => ({
      density: "SPARSE_ALL",
      name: `${DB}/collectionGroups/${index.collectionGroup}/indexes/id${number}`,
      queryScope: index.queryScope,
      fields: structuredClone(index.fields),
      state: "READY",
    })),
    // gcloud lists the overrides: the recorded override shape for items/n, one inherited and
    // one TTL-only field (ignored), and pk's wildcard (outside the judged groups).
    fields: [
      overrideCollectionGroupOnly(),
      inheritedField("flt", "s"),
      ttlOnlyField(),
      overrideExempted("pk", "*"),
    ],
    database: Object.assign(recordedDatabase(), { name: DB }),
  };
}

test("the faithful observation passes, and so does one without a database edition", () => {
  assert.deepEqual(providerStateProblems(goodObservation()), []);
  const old = goodObservation();
  delete old.database.databaseEdition;
  assert.deepEqual(providerStateProblems(old), []);
  assert.equal(expectedComposites().length, committedIndexes.length);
  assert.equal(
    providerStateDigest(),
    sha(JSON.stringify(expectedProviderState())),
    "the digest is the sha256 of the expectation itself",
  );
  assert.notEqual(providerStateDigest(), "0".repeat(64));
  assert.deepEqual(expectedProviderState().overrides["items/n"], [
    { scope: "COLLECTION_GROUP", fields: "n:ASCENDING" },
  ]);
});

test("each way the sandbox can differ from the judges' assumption is named and refused", () => {
  const drift = (mutate) => {
    const observation = goodObservation();
    mutate(observation);
    return providerStateProblems(observation).join("\n");
  };
  assert.match(
    drift((o) => o.composite.pop()),
    /composite index missing/,
  );
  assert.match(
    drift((o) =>
      o.composite.push({
        name: `${DB}/collectionGroups/items/indexes/x`,
        queryScope: "COLLECTION",
        fields: [{ fieldPath: "n", order: "ASCENDING" }],
        state: "READY",
      }),
    ),
    /unexpected composite index: items\|COLLECTION\|n:ASCENDING/,
  );
  assert.match(
    drift((o) => (o.composite.find((i) => i.name.includes("/flt/")).state = "CREATING")),
    /composite index on flt is CREATING/,
  );
  assert.match(
    drift(
      (o) => (o.composite.find((i) => i.name.includes("/flt/")).fields[1].order = "DESCENDING"),
    ),
    /composite index missing/,
  );
  assert.match(
    drift((o) => o.fields.shift()),
    /field override missing: items\/n/,
  );
  assert.match(
    drift((o) =>
      o.fields[0].indexConfig.indexes.push({
        queryScope: "COLLECTION",
        fields: [{ fieldPath: "n", order: "DESCENDING" }],
      }),
    ),
    /field override items\/n is/,
  );
  assert.match(
    drift((o) => (o.fields[0].indexConfig.indexes[0].queryScope = "COLLECTION")),
    /field override items\/n is/,
  );
  assert.match(
    drift((o) => o.fields.push(overrideExempted("flt", "s"))),
    /unexpected field override: flt\/s/,
  );
  assert.match(
    drift((o) => o.fields.push(overrideExempted("wlbase64", "*"))),
    /unexpected field override: wlbase64\/\*/,
  );
  assert.match(
    drift((o) => (o.database.type = "DATASTORE_MODE")),
    /database type is DATASTORE_MODE/,
  );
  assert.match(
    drift((o) => (o.database.concurrencyMode = "OPTIMISTIC")),
    /concurrency mode is OPTIMISTIC/,
  );
  assert.match(
    drift((o) => (o.database.locationId = "nam5")),
    /location is nam5/,
  );
  assert.match(
    drift((o) => (o.database.databaseEdition = "ENTERPRISE")),
    /edition is ENTERPRISE/,
  );
  assert.match(
    drift((o) => (o.database.name = "projects/other/databases/(default)")),
    /database description is not/,
  );
  assert.match(
    drift((o) => (o.composite = {})),
    /composite list is not a JSON array/,
  );
  assert.match(
    drift((o) => (o.fields = null)),
    /field list is not a JSON array/,
  );
});

test("recorded shapes: an override is judged (key absent), inherited and TTL-only fields are ignored", () => {
  const ok = goodObservation();
  assert.deepEqual(providerStateProblems(ok), []);
  // The pre-fix reading: entries with the key absent were skipped, so items/n looked missing.
  const items = ok.fields[0];
  assert.equal(Object.hasOwn(items.indexConfig, "usesAncestorConfig"), false);
  assert.equal(inheritedField("flt", "s").indexConfig.usesAncestorConfig, true);
  assert.equal(ttlOnlyField().indexConfig.usesAncestorConfig, true);
  assert.equal(Object.hasOwn(ok.fields[3].indexConfig, "indexes"), false);
  // An override on a group the judges do not use is ignored.
  const other = goodObservation();
  other.fields.push(overrideExempted("other", "z"));
  assert.deepEqual(providerStateProblems(other), []);
  // A judged group with only the inherited shape has no override.
  const inheritedOnly = goodObservation();
  inheritedOnly.fields[0] = inheritedField("items", "n");
  assert.match(providerStateProblems(inheritedOnly).join("\n"), /field override missing: items\/n/);
  // An explicit false (a client that keeps the default) is still an override.
  const explicit = goodObservation();
  explicit.fields[0].indexConfig.usesAncestorConfig = false;
  assert.deepEqual(providerStateProblems(explicit), []);
  // An entry that carries no indexConfig cannot be read.
  const unreadable = goodObservation();
  delete unreadable.fields[0].indexConfig;
  assert.match(providerStateProblems(unreadable).join("\n"), /items\/n has no indexConfig/);
});

test("the composite fixture has the key layout of the recorded index body", () => {
  assert.deepEqual(Object.keys(goodObservation().composite[0]).toSorted(), recordedIndexKeys());
  const db = goodObservation().database;
  for (const key of ["type", "locationId", "concurrencyMode", "databaseEdition", "name"]) {
    assert.ok(Object.hasOwn(db, key), key);
  }
});

test("the files the coordinator saves are read, checked and digested", () => {
  const dir = mkdtempSync(join(tmpdir(), "fswl-ps-"));
  const write = (name, value) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const o = goodObservation();
  const paths = {
    composite: write("c.json", o.composite),
    fields: write("f.json", o.fields),
    database: write("d.json", o.database),
  };
  const ok = checkProviderStateFiles(paths);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(Object.keys(ok.sha256), ["composite", "fields", "database"]);
  o.database.concurrencyMode = "OPTIMISTIC";
  paths.database = write("d2.json", o.database);
  assert.equal(checkProviderStateFiles(paths).problems.length, 1);
  assert.match(GCLOUD_COMMANDS.composite, /indexes composite list --project fireemu-oracle-sbx/);
});

test("the parent needs the three observation files for writelimits and refuses them elsewhere", () => {
  const base = [
    "--nonce",
    "a",
    "--review",
    "r",
    "--review-sha256",
    "0".repeat(64),
    "--packet",
    "p",
    "--packet-sha256",
    "1".repeat(64),
  ];
  const extra = [
    "--composite-indexes",
    "c",
    "--field-overrides",
    "f",
    "--database-description",
    "d",
  ];
  assert.deepEqual(requireBracketArguments([...base, ...extra], "writelimits").providerState, {
    composite: "c",
    fields: "f",
    database: "d",
  });
  assert.throws(() => requireBracketArguments(base, "writelimits"), /--composite-indexes/);
  assert.throws(
    () => requireBracketArguments([...base, ...extra.slice(0, 4)], "writelimits"),
    /--database-description/,
  );
  assert.throws(() => requireBracketArguments([...base, ...extra], "bracket"), /requires --nonce/);
  assert.throws(
    () => requireBracketArguments([...base, ...extra, "--composite-indexes", "x"], "writelimits"),
    /requires/,
  );
  assert.equal("providerState" in requireBracketArguments(base, "bracket"), false);
});

test("the plan pins the provider-state expectation for writelimits only", async () => {
  const withState = productionAdmissionPlan("writelimits", {
    sourceCorpusDigest: sha("c"),
    recordingCorpus,
  });
  assert.equal(withState.providerStateSha256, providerStateDigest());
  const old = (await prepareSandboxCorpus()).corpus;
  const selection = selectBracketRecipes(old, "bracket");
  assert.equal("providerStateSha256" in productionAdmissionPlan("bracket", selection), false);
});

const gatePins = (parent) => ({
  parent,
  packetId: "fs-data-write-writelimits-aaaa",
  nonce: "a".repeat(24),
  packetSha256: "1".repeat(64),
  sourceCommit: "b".repeat(40),
  planSha256: "c".repeat(64),
  packetPath: "docs.local/runs/fs-write-limits/v2-snapshot/PACKET-v2.md",
});
const ownerRow = (parent, approver = "オーナー（台帳2568、Claude経由）") => {
  const pins = gatePins(parent);
  return `- 2026-11-17 | ${parent} | packetSha256=${pins.packetSha256}; sourceCommit=${pins.sourceCommit}; planSha256=${pins.planSha256}; nonce=${pins.nonce} | ${approver} | ${pins.packetPath}\n`;
};
const NOW = Date.parse("2026-11-18T00:00:00Z");

test("writelimits is approved by a row naming its own parent and an owner approver, and by nothing looser", () => {
  assert.equal(ownerRowParent("writelimits"), "FS-WRITE-LIMITS-SANDBOX");
  assert.equal(ownerRowParent("bracket"), "FS-DATA-WRITE");
  const gate = (decisions, pins) => verifyBracketSendGates({ rows: [], now: NOW, decisions, pins });
  const parent = "FS-WRITE-LIMITS-SANDBOX";
  assert.deepEqual(gate(ownerRow(parent), gatePins(parent)), { lastActivity: null });
  assert.throws(() => gate(ownerRow("FS-DATA-WRITE"), gatePins(parent)), /approval row/);
  assert.throws(() => gate(ownerRow(parent, "調整役"), gatePins(parent)), /approval row/);
  assert.throws(() => gate(ownerRow(parent) + ownerRow(parent), gatePins(parent)), /approval row/);
  assert.throws(
    () =>
      gate(
        ownerRow(parent).replace("nonce=" + "a".repeat(24), "nonce=" + "d".repeat(24)),
        gatePins(parent),
      ),
    /approval row/,
  );
  assert.throws(
    () => gate(ownerRow(parent).replace("PACKET-v2", "PACKET-v1"), gatePins(parent)),
    /approval row/,
  );
  // The older modes keep their parent: a row for the new parent does not approve them.
  assert.deepEqual(gate(ownerRow("FS-DATA-WRITE"), gatePins(undefined)), { lastActivity: null });
  assert.throws(() => gate(ownerRow(parent), gatePins(undefined)), /approval row/);
});

test("the parent refuses to start, before any credential or ledger read, when the sandbox differs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fswl-parent-"));
  const o = goodObservation();
  o.fields.shift();
  const save = (name, value) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const args = [
    "--nonce",
    "a".repeat(24),
    "--review",
    "r",
    "--review-sha256",
    "0".repeat(64),
    "--packet",
    "p",
    "--packet-sha256",
    "1".repeat(64),
    "--composite-indexes",
    save("c.json", o.composite),
    "--field-overrides",
    save("f.json", o.fields),
    "--database-description",
    save("d.json", o.database),
  ];
  await assert.rejects(
    recordBracketProduction(args, "writelimits"),
    /the sandbox differs from what the judges assume: field override missing: items\/n/,
  );
  await assert.rejects(
    recordBracketProduction(args.slice(0, -6), "writelimits"),
    /--database-description/,
  );
});

test("the gate pins carry the mode's parent, the packet's path under the main checkout and the admission's pins", () => {
  const admission = {
    nonce: "a".repeat(24),
    sourceCommit: "b".repeat(40),
    planSha256: "c".repeat(64),
  };
  const pins = { packetSha256: "1".repeat(64) };
  const make = (mode) =>
    bracketGatePins({
      mode,
      admission,
      pins,
      mainRoot: "/main",
      packetPath: "/main/docs.local/runs/fs-write-limits/v2-snapshot/PACKET-v2.md",
    });
  assert.deepEqual(make("writelimits"), {
    parent: "FS-WRITE-LIMITS-SANDBOX",
    packetId: `fs-data-write-writelimits-${"a".repeat(24)}`,
    nonce: "a".repeat(24),
    packetSha256: "1".repeat(64),
    sourceCommit: "b".repeat(40),
    planSha256: "c".repeat(64),
    packetPath: "docs.local/runs/fs-write-limits/v2-snapshot/PACKET-v2.md",
  });
  assert.equal(make("followup").parent, "FS-DATA-WRITE");
});

// ---- the typed batchGet answer arrives in no fixed order (writelimits run 20261117-01) ----

const rows = (order) => ({
  "writes/limits/commit-budget/40x3": {
    steps: {
      write: {
        status: 400,
        code: "INVALID_ARGUMENT",
        message: "Transaction too big. Decrease transaction size.",
      },
      readback: {
        status: 200,
        code: "OK",
        body: order.map((name) => ({
          missing: `projects/p/databases/(default)/documents/${name}`,
        })),
      },
    },
  },
});

test("two recordings that differ only in the order of a typed batchGet answer agree", () => {
  assert.deepEqual(compareRecordings(rows(["a", "b", "c"]), rows(["b", "a", "c"])), []);
  const found = (name) => ({
    found: { name: `projects/p/databases/(default)/documents/${name}`, fields: {} },
  });
  const first = rows(["a"]);
  first["writes/limits/commit-budget/40x3"].steps.readback.body = [
    found("b"),
    { missing: "projects/p/databases/(default)/documents/a" },
  ];
  const second = structuredClone(first);
  second["writes/limits/commit-budget/40x3"].steps.readback.body.reverse();
  assert.deepEqual(compareRecordings(first, second), []);
});

test("a batchGet answer that differs in content, and any other array's order, still differ", () => {
  assert.deepEqual(compareRecordings(rows(["a", "b", "c"]), rows(["a", "b", "d"])), [
    "writes/limits/commit-budget/40x3#readback",
  ]);
  assert.deepEqual(compareRecordings(rows(["a", "b"]), rows(["a", "b", "c"])), [
    "writes/limits/commit-budget/40x3#readback",
  ]);
  const found = rows(["a", "b"]);
  found["writes/limits/commit-budget/40x3"].steps.readback.body[0] = {
    found: { name: "projects/p/databases/(default)/documents/a", fields: {} },
  };
  assert.deepEqual(compareRecordings(rows(["a", "b"]), found), [
    "writes/limits/commit-budget/40x3#readback",
  ]);
  const stream = (order) => ({
    q: {
      steps: {
        rows: { status: 200, code: "OK", body: order.map((n) => ({ document: { name: n } })) },
      },
    },
  });
  assert.deepEqual(compareRecordings(stream(["x", "y"]), stream(["y", "x"])), ["q#rows"]);
});

// ---- the volatile transport trailer on a unary status inside a stream recording ----

const trailer = { key: "x-debug-tracking-id", kind: "ascii", value: "nonempty-volatile-id" };
const attachment = { key: "content-disposition", kind: "ascii", value: "attachment" };
const streamRecord = (readbackTrailers, statusTrailers) => ({
  sentFrames: 2,
  status: { code: 0, details: "", trailers: statusTrailers },
  events: [
    { type: "seed", status: { code: 0, details: "", trailers: readbackTrailers } },
    { type: "status", value: { code: 0, details: "", trailers: statusTrailers } },
    {
      type: "readback",
      found: false,
      arrayCount: 0,
      status: { code: 5, details: "gone", trailers: readbackTrailers },
    },
  ],
});

test("the volatile tracking trailer is ignored wherever a stream recording carries a status", () => {
  const id = "writes/limits/write-stream-delete/12112";
  const production = { streams: { [id]: streamRecord([trailer], [attachment, trailer]) } };
  const local = { [id]: streamRecord([], [attachment]) };
  assert.deepEqual(compareSandboxArtifact(production, {}, local, { restPrograms: [] }), []);
  // A stable trailer is still compared, on the final status and inside a read-back.
  const missing = { [id]: streamRecord([], []) };
  assert.deepEqual(compareSandboxArtifact(production, {}, missing, { restPrograms: [] }), [
    `${id}#grpc`,
  ]);
  const code = streamRecord([trailer], [attachment, trailer]);
  code.events[2].status.code = 3;
  assert.deepEqual(
    compareSandboxArtifact({ streams: { [id]: code } }, {}, local, { restPrograms: [] }),
    [`${id}#grpc`],
  );
});
