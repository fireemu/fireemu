// The recorded Batch 3 supplements: bound to the current recipes, free of private identity, and
// compared with a local run by content. The local run itself (fireemu strict against these
// recordings) is `fs-write-limits-compare.mjs <rehearsal run dir>`; its result is in the commit
// that added the fixtures.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { compareWriteLimits, readSupplements, SUPPLEMENTS } from "./fs-write-limits-compare.mjs";
import { freezeRecordedGroups } from "./fs-write-limits-freeze.mjs";
import {
  bracketGroupCorpora,
  prepareWriteLimitsCorpus,
  selectBracketRecipes,
} from "./fs-data-write-sandbox-run.mjs";

const { recordingCorpus } = selectBracketRecipes(await prepareWriteLimitsCorpus(), "writelimits");
const groups = bracketGroupCorpora(recordingCorpus, "writelimits");
const supplements = await readSupplements();
const GROUP_NAMES = groups.map(({ group }) => group).toSorted();

const recordedAsLocal = () => {
  const rest = {};
  const stream = {};
  for (const supplement of Object.values(supplements)) {
    for (const [id, program] of Object.entries(supplement.programs)) rest[id] = program;
    Object.assign(stream, supplement.streams);
  }
  return { rest, stream };
};

test("one supplement per freeze group, each bound to the current recipes", () => {
  assert.deepEqual(Object.keys(supplements).toSorted(), GROUP_NAMES);
  const { rest, stream } = recordedAsLocal();
  const result = compareWriteLimits({ rest, stream, supplements, groups });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.differences, []);
  assert.equal(result.compared, 61 + 3);
});

test("a changed recipe unbinds its supplement; a missing supplement is a problem", () => {
  const { rest, stream } = recordedAsLocal();
  const changed = structuredClone(groups);
  changed[0].corpus.restPrograms[0].steps[0].path += "x";
  const unbound = compareWriteLimits({ rest, stream, supplements, groups: changed });
  assert.match(unbound.problems.join("\n"), /is not bound to the current recipes/);
  const { budget, ...others } = supplements;
  assert.ok(budget);
  const missing = compareWriteLimits({ rest, stream, supplements: others, groups });
  assert.deepEqual(missing.problems, ["no recorded supplement for the budget group"]);
});

test("a local row that differs from production is named, step by step", () => {
  const { rest, stream } = recordedAsLocal();
  const local = structuredClone(rest);
  local["writes/limits/commit-budget/60x2"].steps.write = { status: 200, code: "OK", body: {} };
  local["writes/limits/composite-entry/heavy/6500"].steps.write.message = "something else";
  const changedStream = structuredClone(stream);
  changedStream["writes/limits/write-stream-delete/12113"].status.code = 0;
  const result = compareWriteLimits({ rest: local, stream: changedStream, supplements, groups });
  assert.deepEqual(result.differences, [
    "writes/limits/commit-budget/60x2#write",
    "writes/limits/composite-entry/heavy/6500#write",
    "writes/limits/write-stream-delete/12113#grpc",
  ]);
});

test("the recorded answers say what the run found", () => {
  const write = (id) => {
    for (const supplement of Object.values(supplements)) {
      if (supplement.programs[`writes/limits/${id}`]) {
        return supplement.programs[`writes/limits/${id}`].steps.write;
      }
    }
    throw new Error(id);
  };
  const refused = (id) => assert.equal(write(id).status, 400, id);
  const accepted = (id) => assert.equal(write(id).status, 200, id);
  for (const id of ["40x2", "60x1", "batch-60x2"]) accepted(`commit-budget/${id}`);
  for (const id of ["55x2", "60x2", "40x3"]) refused(`commit-budget/${id}`);
  accepted("composite-entry/heavy/6000");
  refused("composite-entry/heavy/6500");
  accepted("collection-group-entry/5700");
  refused("collection-group-entry/6000");
  for (const method of ["create", "patch", "batch-write"]) {
    accepted(`bytes-line-breaks/${method}/control`);
    accepted(`bytes-line-breaks/${method}/proto-name`);
    refused(`bytes-line-breaks/${method}/lf`);
    refused(`bytes-line-breaks/${method}/mixed-minus-slash`);
  }
  assert.match(
    write("bytes-line-breaks/create/lf").message,
    /^Invalid value at 'document\.fields\[0\]\.value\.bytes_value' \(TYPE_BYTES\), Base64 decoding failed for "QUJD\nQUJD"$/,
  );
  assert.match(
    write("bytes-line-breaks/batch-write/lf").message,
    /^Invalid value at 'writes\[0\]\.update\.fields\[0\]\.value\.bytes_value'/,
  );
  const streams = Object.values(supplements).flatMap((s) => Object.entries(s.streams));
  const code = (id) => streams.find(([key]) => key.endsWith(id))[1].status.code;
  assert.deepEqual([code("12112"), code("12113"), code("12122")], [0, 3, 3]);
});

test("the supplements carry no credential, sandbox project, project number or gsessionid", async () => {
  const files = (await readdir(SUPPLEMENTS)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 5);
  for (const name of files) {
    const text = await readFile(join(SUPPLEMENTS, name), "utf8");
    assert.ok(!/fireemu-oracle|ya29\.|Bearer |gsessionid/.test(text), name);
    assert.ok(text.includes("demo-firestore-probe") || !text.includes("projects/"), name);
    // 12 or 13 digit runs outside a hex digest would be a project number.
    const withoutDigests = text.replace(/[0-9a-f]{32,}/g, " ");
    assert.ok(!/(?<!\d)\d{10,13}(?!\d)/.test(withoutDigests), name);
  }
});

test("freezing the saved attempts again gives the committed supplements", async () => {
  const attempt = (order) => {
    const { rest, stream } = recordedAsLocal();
    const copy = structuredClone(rest);
    // Two attempts that differ only in the order of a typed batchGet answer.
    const readback = copy["writes/limits/commit-budget/40x3"].steps.readback;
    if (order) readback.body.reverse();
    return { rest: copy, stream, startedAt: "2026-11-17T05:16:18.521Z" };
  };
  const results = await freezeRecordedGroups({
    recordings: [attempt(false), { ...attempt(true), startedAt: "2026-11-17T05:18:17.725Z" }],
    harnessRevision: "5665cc8310c6cefee4a249b54445a5507abde105",
    sdkVersions: supplements.budget.evidence.sdkVersions,
  });
  assert.deepEqual(
    results.filter(({ refused }) => refused),
    [],
  );
  for (const { group, fixture } of results) {
    assert.deepEqual(fixture.programs, supplements[group].programs, group);
    assert.deepEqual(fixture.streams, supplements[group].streams, group);
    assert.deepEqual(fixture.recipeDigests, supplements[group].recipeDigests, group);
  }
});

test("a freeze needs exactly two attempts", async () => {
  await assert.rejects(
    freezeRecordedGroups({ recordings: [], harnessRevision: "0".repeat(40), sdkVersions: {} }),
    /two recorded attempts/,
  );
});
