import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FILES } from "./evidence.mjs";
import {
  compareRuns,
  diffValues,
  etagForm,
  eventRows,
  form,
  idForm,
  namespaceOf,
  RACE,
  defaultsEntries,
} from "./judge.mjs";

const ROOT = new URL("../../../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));

const MEMBER_ORDER = {
  id: "KD-TEST-ORDER",
  rows: ["*"],
  fields: [],
  fieldSuffixes: [":member-order"],
  appliesTo: ["production-vs-local"],
};

function answer(caseName, path, body, extra = {}) {
  const text = JSON.stringify(body, null, 2);
  return {
    case: caseName,
    path,
    phase: "response-persisted",
    status: 200,
    bodyBytes: Buffer.byteLength(text),
    skeletonBytes: 0,
    unicodeEscapes: 0,
    contentType: "application/json; charset=UTF-8",
    contentEncoding: "gzip",
    etag: null,
    body,
    ...extra,
  };
}

function runOf(base, rows, { events = [], versions = [], summary = null } = {}) {
  return {
    baseline: { client: { version: base.client }, server: { version: base.server } },
    rows,
    events,
    versions,
    summary,
  };
}

const CLIENT = "/v1/projects/PROJECT_ID/remoteConfig";
const SERVER = "/v1/projects/PROJECT_ID/namespaces/firebase-server/remoteConfig";

test("form compares versions as offsets from the namespace baseline and times by form", () => {
  assert.deepEqual(
    form(
      {
        versionNumber: "30",
        rollbackSource: "28",
        updateTime: "2026-11-24T03:12:51.022725Z",
        description: "Rollback to version 28",
        nextPageToken: "24",
        other: "30",
      },
      "27",
    ),
    {
      versionNumber: "v:3",
      rollbackSource: "v:1",
      updateTime: "t:ok:Z",
      description: "r:1",
      nextPageToken: "v:-3",
      other: "s:30",
    },
  );
  assert.equal(form({ rollbackSource: "0" }, "27").rollbackSource, "s:0");
  // Times by the field's kind (ruling 11 item 1): protobuf digits for REST and Gen2, no trailing
  // zeros for Gen1.
  const at = (time, rule) => form({ updateTime: time }, "1", null, null, rule).updateTime;
  for (const time of ["00Z", "00.949Z", "00.370Z", "00.193490Z", "00.123456789Z"])
    assert.equal(at(`2026-01-01T00:00:${time}`, "proto"), "t:ok:Z", time);
  assert.equal(at("2026-01-01T00:00:00.12Z", "proto"), "t:other:2:12:Z");
  assert.equal(at("2026-01-01T00:00:00.250000Z", "proto"), "t:other:6:250000:Z");
  assert.equal(at("2026-01-01T00:00:00.000Z", "proto"), "t:other:3:000:Z");
  for (const time of ["00Z", "00.949Z", "00.12Z", "00.19349Z", "00.408063Z"])
    assert.equal(at(`2026-01-01T00:00:${time}`, "minimal"), "t:ok:Z", time);
  assert.equal(at("2026-01-01T00:00:00.120Z", "minimal"), "t:other:3:120:Z");
  assert.equal(at("2026-01-01T00:00:00.193490Z", "minimal"), "t:other:6:193490:Z");
  assert.equal(form({ updateTime: "2026-01-01T00:00:00.12Z" }, "1").updateTime, "t:other:2:12:Z");
  assert.equal(form({ nextPageToken: "etag-x-1" }, "1").nextPageToken, "s:etag-x-1");
  // A tag no input string can take: the literal text of a normalised form stays a string.
  assert.equal(form({ updateTime: "t:6:Z" }, "1").updateTime, "s:t:6:Z");
  // A version spelled with a leading zero is compared as written.
  assert.equal(form({ versionNumber: "028" }, "27").versionNumber, "s:028");
  assert.equal(
    form({ description: "Rollback to version 028" }, "27").description,
    "s:Rollback to version 028",
  );
  assert.equal(namespaceOf(SERVER), "server");
  assert.equal(namespaceOf(CLIENT), "client");
});

test("idForm and etagForm keep the sign, the prefix kind and the validation tag", () => {
  assert.equal(idForm("929360796"), "id:int32");
  assert.equal(idForm("2147483647"), "id:int32");
  assert.equal(idForm("2147483648"), "id:other:10");
  // Production's ids take either sign (RC-CLOSURE-A, both passes).
  assert.equal(idForm("-351892884"), "id:int32");
  assert.equal(idForm("-2147483648"), "id:int32");
  assert.equal(idForm("-2147483649"), "id:other:11");
  assert.equal(idForm("-0"), "id:other:2");
  assert.equal(idForm("-01"), "id:other:3");
  assert.equal(idForm("01"), "id:other:2");
  assert.equal(idForm("0"), "id:other:1");
  assert.equal(etagForm(null, "1"), null);
  assert.equal(etagForm("etag-PROJECT_NUMBER-28", "27"), "project-number:version:1");
  assert.equal(etagForm("etag-PROJECT_NUMBER-0", "27"), "project-number:0");
  assert.equal(etagForm(`etag-fireemu-${"a".repeat(32)}-11`, "10"), "fireemu-hash:version:1");
  assert.equal(etagForm("etag-other-3", "1"), "other:5:version:2");
  assert.equal(etagForm("W/x", "1"), "unrecognised:3");
});

test("diffValues reports missing members on each side, member order, lengths and values", () => {
  assert.deepEqual(diffValues({ a: 1, b: 2 }, { b: 2, a: 1 }), ["body:member-order"]);
  assert.deepEqual(diffValues({ a: 1 }, { b: 1 }), ["body.a:missing-right", "body.b:missing-left"]);
  assert.deepEqual(diffValues([1, 2], [1]), ["body:length"]);
  assert.deepEqual(diffValues({ a: [1, { c: "x" }] }, { a: [1, { c: "y" }] }), [
    "body.a[1].c:value",
  ]);
  assert.deepEqual(diffValues(1, "1"), ["body:value"]);
  assert.deepEqual(diffValues(null, null), []);
});

test("compareRuns: MATCH, MATCH_LAYOUT, KNOWN_DIFFERENCE, MISMATCH and UNKNOWN", () => {
  const left = runOf({ client: "27", server: "6" }, [
    answer("same", CLIENT, { version: { versionNumber: "28" } }),
    answer("layout", CLIENT, {
      version: { versionNumber: "28", updateTime: "2026-11-24T03:12:51.022725Z" },
    }),
    answer("order", CLIENT, { a: 1, b: 2 }),
    answer("status", CLIENT, { error: {} }, { status: 400 }),
    answer("unanswered", CLIENT, {}, { phase: "unknown" }),
    answer("only-left", CLIENT, {}),
  ]);
  const right = runOf({ client: "10", server: "20" }, [
    answer("same", CLIENT, { version: { versionNumber: "28" } }),
    answer("layout", CLIENT, {
      version: { versionNumber: "11", updateTime: "2026-01-01T00:00:00.000001Z" },
    }),
    answer("order", CLIENT, { b: 2, a: 1 }),
    answer("status", CLIENT, { error: {} }),
    answer("unanswered", CLIENT, {}),
  ]);
  // "same" has equal raw values but different offsets (28-27 against 28-10).
  const rows = Object.fromEntries(
    compareRuns(left, right, { known: [MEMBER_ORDER], kind: "production-vs-local" }).rows.map(
      (r) => [r.id, r],
    ),
  );
  assert.equal(rows.same.status, "MISMATCH");
  assert.deepEqual(rows.same.differences, ["body.version.versionNumber:value"]);
  assert.equal(rows.layout.status, "MATCH_LAYOUT");
  assert.equal(rows.order.status, "KNOWN_DIFFERENCE");
  assert.deepEqual(rows.order.knownDifferences, ["KD-TEST-ORDER"]);
  assert.equal(rows.status.status, "MISMATCH");
  assert.deepEqual(rows.status.differences, ["status"]);
  assert.equal(rows.unanswered.status, "UNKNOWN");
  assert.equal(rows.unanswered.reason, "unanswered");
  assert.equal(rows["only-left"].status, "UNKNOWN");
  assert.equal(rows["only-left"].reason, "missing-row");
  const plain = compareRuns(left, left, { known: [], kind: "production-vs-local" });
  assert.equal(plain.counts.MATCH, 5);
  assert.equal(plain.counts.UNKNOWN, 1);
  const unknownKind = compareRuns(left, right, { known: [MEMBER_ORDER], kind: "run-vs-run" });
  assert.equal(unknownKind.rows.find((r) => r.id === "order").status, "MISMATCH");
});

test("compareRuns ignores older history entries and the baseline reads' version, and their lengths", () => {
  const history = (versions, extra) =>
    answer(
      "h-client-history",
      `${CLIENT}:listVersions`,
      { versions },
      { bodyBytes: 1, skeletonBytes: 1, ...extra },
    );
  const left = runOf({ client: "27", server: "6" }, [
    history([{ versionNumber: "28" }, { versionNumber: "27", description: "old" }]),
    answer(
      "a-client",
      CLIENT,
      { version: { versionNumber: "27", updateType: "ROLLBACK" } },
      { skeletonBytes: 5 },
    ),
    answer("a-server", SERVER, { version: { versionNumber: "6" }, extra: 1 }),
  ]);
  const right = runOf({ client: "10", server: "20" }, [
    history([{ versionNumber: "11" }, { versionNumber: "10", description: "setup", more: 1 }], {
      bodyBytes: 2,
      skeletonBytes: 2,
    }),
    answer(
      "a-client",
      CLIENT,
      { version: { versionNumber: "10", updateType: "FORCED_UPDATE" } },
      { skeletonBytes: 9 },
    ),
    answer("a-server", SERVER, { version: { versionNumber: "20" } }),
  ]);
  const rows = Object.fromEntries(
    compareRuns(left, right, { kind: "production-vs-local" }).rows.map((r) => [r.id, r]),
  );
  assert.equal(rows["h-client-history"].status, "MATCH_LAYOUT");
  assert.equal(rows["a-client"].status, "MATCH");
  assert.equal(rows["a-server"].status, "MISMATCH");
  assert.deepEqual(rows["a-server"].differences, ["body.extra:missing-right"]);
  // A new history entry that differs is still compared.
  const changed = runOf({ client: "10", server: "20" }, [
    history([{ versionNumber: "11", description: "x" }]),
  ]);
  assert.equal(
    compareRuns(
      runOf({ client: "27", server: "6" }, [history([{ versionNumber: "28" }])]),
      changed,
      { kind: "production-vs-local" },
    ).rows[0].status,
    "MISMATCH",
  );
});

test("eventRows: one row per step and generation, the shared id, duplicates, and the summary without counts", () => {
  const versions = [{ namespace: "client", step: "c0", versionNumber: "28", updateTime: "t" }];
  const event = (generation, eventId) => ({
    generation,
    eventId,
    versionNumber: "28",
    updateTime: "t",
    data: { versionNumber: "28" },
    context: {},
  });
  const summary = {
    generations: {
      1: { events: 9, unmatched: 3, duplicates: [{ eventId: "1", count: 2 }], clientSteps: ["c0"] },
    },
  };
  const rows = eventRows({
    baseline: { client: { version: "27" } },
    versions,
    events: [event(1, "5"), event(2, "5"), { ...event(1, "5"), updateTime: "other" }],
    summary,
  });
  assert.deepEqual(
    [...rows.keys()],
    [
      "event:client:c0:g1",
      "event:client:c0:g2",
      "event-ids",
      "event-id:c0",
      "summary:g1",
      "summary:g2",
    ],
  );
  assert.deepEqual(rows.get("event-id:c0").value, { shared: true });
  // The summary is computed from the events: the third event names no version of the run.
  // The third event names no version of the run: an unmatched delivery (ruling 11 item 3).
  assert.deepEqual(rows.get("summary:g1").value, {
    clientSteps: ["c0"],
    serverSteps: [],
    duplicates: 0,
    unmatched: 1,
    inPublicationOrder: true,
  });
  assert.deepEqual(rows.get("event:client:c0:g1").valueForm.data, { versionNumber: "v:1" });
  const split = eventRows({
    baseline: { client: { version: "27" } },
    versions,
    events: [event(1, "5"), event(2, "6")],
  });
  assert.deepEqual(split.get("event-id:c0").value, { shared: false });
  const run = (events) => ({
    baseline: { client: { version: "27" }, server: { version: "6" } },
    rows: [],
    versions,
    events,
  });
  const idRow = compareRuns(
    run([event(1, "5"), event(2, "5")]),
    run([event(1, "5"), event(2, "6")]),
    {
      kind: "production-vs-local",
    },
  ).rows.find((r) => r.id === "event-id:c0");
  assert.equal(idRow.status, "MISMATCH");
  assert.deepEqual(idRow.differences, ["event.shared:value"]);
  const twice = eventRows({
    baseline: { client: { version: "27" } },
    versions,
    events: [event(1, "5"), event(1, "5")],
  });
  assert.deepEqual(twice.get("event:client:c0:g1"), { duplicate: true });
  const left = {
    baseline: { client: { version: "27" }, server: { version: "6" } },
    rows: [],
    versions,
    events: [event(1, "5"), event(1, "5")],
  };
  assert.equal(compareRuns(left, left, { kind: "production-vs-local" }).rows[0].status, "UNKNOWN");
});

// The committed comparison of the recorded RC-OBSERVE-V2-3 answers (send-v2.3) against strict fireemu.
test("recorded answers: the strict refusals of the four recorded server forms match production", () => {
  const production = read(FILES.production);
  const strict = read(FILES.localStrict);
  const rows = Object.fromEntries(
    compareRuns(production, strict, {
      known: [MEMBER_ORDER],
      kind: "production-vs-local",
    }).rows.map((r) => [r.id, r]),
  );
  for (const id of ["s-validate-20", "s-validate-21", "s-validate-22", "s-validate-23"]) {
    assert.equal(production.rows.find((r) => r.case === id).status, 400, id);
    assert.deepEqual(rows[id].differences, [], id);
  }
  // Stage 2 (rulings 2 and 4): strict differs from the recording only by member order, and the
  // raw handlers observe the same envelope layer as production's.
  assert.equal(production.rows[0].contentType, "application/json; charset=UTF-8");
  const statuses = new Set(Object.values(rows).map((row) => row.status));
  assert.deepEqual([...statuses].toSorted(), ["KNOWN_DIFFERENCE", "MATCH"]);
  for (const row of Object.values(rows))
    if (row.status === "KNOWN_DIFFERENCE")
      assert.deepEqual(row.knownDifferences, ["KD-TEST-ORDER"], row.id);
  for (const id of ["event-id:c0", "event-id:c1", "event-id:c2", "event-id:c3", "event-id:c4"])
    assert.equal(rows[id].status, "MATCH", id);
});

// Coordinator ruling 3 (2026-11-24, review of 9bf6af99f): the review's false matches.
const recorded = () => read(FILES.production);
const rowOf = (run, id) => run.rows.find((row) => row.case === id);
const verdictOf = (left, right, id) =>
  compareRuns(left, right, { known: [MEMBER_ORDER], kind: "production-vs-local" }).rows.find(
    (r) => r.id === id,
  );

test("an escape moved to another character of the same field is a difference", () => {
  const production = recorded();
  const moved = structuredClone(production);
  const row = rowOf(moved, "s-validate-03");
  const [path, [[index, sequence]]] = Object.entries(row.escapes).find(([, found]) =>
    found.some(([, s]) => s === "\\u003c"),
  );
  assert.equal(sequence, "\\u003c");
  row.escapes[path] = [[0, "\\u0070"]];
  assert.ok(index > 0);
  const result = verdictOf(production, moved, "s-validate-03");
  assert.equal(result.status, "MISMATCH");
  assert.deepEqual(result.differences, [`escapes:${path}`]);
});

test("an ETag version with a leading zero and a literal normalised form are differences", () => {
  const production = recorded();
  const padded = structuredClone(production);
  rowOf(padded, "c0-publish").etag = "etag-PROJECT_NUMBER-028";
  assert.deepEqual(verdictOf(production, padded, "c0-publish").differences, ["etag"]);
  assert.equal(etagForm("etag-PROJECT_NUMBER-028", "27"), "noncanonical:14:028");
  const literal = structuredClone(production);
  rowOf(literal, "c0-publish").body.version.updateTime = "time:6:Z";
  assert.equal(verdictOf(production, literal, "c0-publish").status, "MISMATCH");
});

test("a member named __proto__ is compared like any other", () => {
  const production = recorded();
  const withProto = (value) => {
    const run = structuredClone(production);
    rowOf(run, "c0-publish").body = JSON.parse(
      `{"parameters":{"__proto__":{"defaultValue":{"value":"${value}"}}}}`,
    );
    return run;
  };
  const a = withProto("A");
  assert.deepEqual(Object.keys(rowOf(a, "c0-publish").body.parameters), ["__proto__"]);
  assert.equal(verdictOf(a, withProto("B"), "c0-publish").status, "MISMATCH");
  assert.equal(verdictOf(a, withProto("A"), "c0-publish").status, "MATCH");
});

test("an event id reused by another publication breaks the recorded id relation", () => {
  const production = recorded();
  const reused = structuredClone(production);
  const c0 = reused.versions.find((v) => v.step === "c0");
  const c1 = reused.versions.find((v) => v.step === "c1");
  const id = reused.events.find((e) => e.versionNumber === c0.versionNumber).eventId;
  for (const event of reused.events.filter(
    (e) => e.versionNumber === c1.versionNumber && e.updateTime === c1.updateTime,
  )) {
    event.eventId = id;
    if (event.generation === 1) event.context.eventId = id;
    else event.context.id = id;
  }
  const result = verdictOf(production, reused, "event-ids");
  assert.equal(result.status, "MISMATCH");
  assert.equal(verdictOf(production, production, "event-ids").status, "MATCH");
});

test("escapes outside the compared body are not compared", () => {
  const history = (escapes) =>
    answer(
      "h-client-history",
      `${CLIENT}:listVersions`,
      { versions: [{ versionNumber: "28" }, { versionNumber: "27", description: "a<b" }] },
      { escapes },
    );
  const left = runOf({ client: "27", server: "6" }, [
    history({ "value:/versions/1/description": [[1, "\\u003c"]] }),
  ]);
  const right = runOf({ client: "27", server: "6" }, [history({})]);
  assert.equal(compareRuns(left, right, { kind: "production-vs-local" }).rows[0].status, "MATCH");
  const inside = runOf({ client: "27", server: "6" }, [
    history({ "value:/versions/0/versionNumber": [[0, "\\u0032"]] }),
  ]);
  assert.deepEqual(
    compareRuns(inside, right, { kind: "production-vs-local" }).rows[0].differences,
    ["escapes:value:/versions/0/versionNumber"],
  );
});

// RC-CLOSURE-A judge rules.
test("messages compare their embedded times by form and the stale-tag versions as offsets", () => {
  assert.equal(
    form(
      {
        message:
          "[VALIDATION_ERROR]: start_time [2026-11-21T01:53:19.585555Z] must be before end_time [2026-11-21T01:53:19.585555Z].",
      },
      "1",
    ).message,
    "s:[VALIDATION_ERROR]: start_time [\u27e8t:ok\u27e9] must be before end_time [\u27e8t:ok\u27e9].",
  );
  assert.equal(
    form(
      {
        message:
          "end_time must be no earlier than 2026-08-22T07:28:37.612323Z [2000-01-01T00:00:00Z specified].",
      },
      "1",
    ).message,
    "s:end_time must be no earlier than \u27e8t:ok\u27e9 [\u27e8t:ok\u27e9 specified].",
  );
  assert.equal(
    form({ message: "[VERSION_MISMATCH]: Expected version 30, found 33 for project: x" }, "27")
      .message,
    "s:[VERSION_MISMATCH]: Expected version \u27e8v:3\u27e9, found \u27e8v:6\u27e9 for project: x",
  );
  assert.equal(
    form({ message: "[VERSION_MISMATCH]: Expected version 030, found 33" }, "27").message,
    "s:[VERSION_MISMATCH]: Expected version 030, found 33",
  );
});

test("defaults files are compared by their entries in order", () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><defaults>\n  <entry>\n    <key>b</key>\n    <value>2</value>\n  </entry>\n  <entry>\n    <key>a</key>\n    <value/>\n  </entry>\n</defaults>';
  assert.deepEqual(Object.entries(defaultsEntries(xml, "application/xml")), [
    ["b", "2"],
    ["a", ""],
  ]);
  const plist =
    "<dict>\n\t<key>b</key>\n\t<string><![CDATA[<&]]></string>\n\t<key>a</key>\n\t<string></string>\n</dict>";
  assert.deepEqual(Object.entries(defaultsEntries(plist, "application/x-plist")), [
    ["b", "<![CDATA[<&]]>"],
    ["a", ""],
  ]);
  assert.equal(defaultsEntries("x", "application/json"), null);
  const row = (text, contentType) => ({
    case: "d-xml",
    path: CLIENT,
    phase: "response-persisted",
    status: 200,
    bodyBytes: text.length,
    skeletonBytes: text.length,
    escapes: {},
    contentType,
    contentEncoding: null,
    etag: null,
    body: null,
    text,
  });
  const swapped = xml
    .replace("<key>b</key>\n    <value>2</value>", "<key>a</key>\n    <value/>")
    .replace(
      "<key>a</key>\n    <value/>\n  </entry>\n</defaults>",
      "<key>b</key>\n    <value>2</value>\n  </entry>\n</defaults>",
    );
  const result = compareRuns(
    runOf({ client: "1", server: "1" }, [row(xml, "application/xml")]),
    runOf({ client: "1", server: "1" }, [row(swapped, "application/xml")]),
    { known: [MEMBER_ORDER], kind: "production-vs-local" },
  );
  assert.deepEqual(result.rows[0].knownDifferences, ["KD-TEST-ORDER"]);
  const empty = compareRuns(
    runOf({ client: "1", server: "1" }, [row("", "application/json")]),
    runOf({ client: "1", server: "1" }, [row("x", "application/json")]),
    { kind: "production-vs-local" },
  );
  assert.ok(empty.rows[0].differences.includes("text"));
});

test("the race pair is one row: one winner each side, refused losers, winners compared without the label", () => {
  const publish = (label, version) =>
    answer(`p7-${label}`, CLIENT, {
      parameters: { fireemu_source: { defaultValue: { value: `${label}-default` } } },
      version: { versionNumber: version },
    });
  const refusal = (label, status, code) =>
    answer(`p7-${label}`, CLIENT, { error: { code: 400, status: code, message: "m" } }, { status });
  const production = runOf({ client: "27", server: "6" }, [
    publish("race-a", "30"),
    refusal("race-b", 412, "FAILED_PRECONDITION"),
  ]);
  const local = runOf({ client: "10", server: "20" }, [
    refusal("race-a", 412, "FAILED_PRECONDITION"),
    publish("race-b", "13"),
  ]);
  const rows = compareRuns(production, local, { kind: "production-vs-local" }).rows;
  assert.deepEqual(
    rows.map((r) => r.id),
    ["p7-race"],
  );
  assert.equal(rows[0].status, "MATCH_LAYOUT");
  // The losers are compared by status and the whole error body (ruling 11 item 6): the other
  // recorded refusal, or the same status with another body, is a difference.
  const otherRecorded = runOf({ client: "10", server: "20" }, [
    publish("race-a", "13"),
    refusal("race-b", 400, "INVALID_ARGUMENT"),
  ]);
  assert.ok(
    compareRuns(production, otherRecorded, {
      kind: "production-vs-local",
    }).rows[0].differences.includes("loser.status"),
  );
  const forged = runOf({ client: "10", server: "20" }, [
    publish("race-a", "13"),
    answer(
      "p7-race-b",
      CLIENT,
      { error: { code: 418, status: "FAILED_PRECONDITION", message: "arbitrary" } },
      { status: 400 },
    ),
  ]);
  const forgedRow = compareRuns(production, forged, { kind: "production-vs-local" }).rows[0];
  assert.equal(forgedRow.status, "MISMATCH");
  assert.ok(forgedRow.differences.includes("loser"));
  const message = runOf({ client: "10", server: "20" }, [
    publish("race-a", "13"),
    answer(
      "p7-race-b",
      CLIENT,
      { error: { code: 400, status: "FAILED_PRECONDITION", message: "other" } },
      { status: 412 },
    ),
  ]);
  assert.deepEqual(
    compareRuns(production, message, { kind: "production-vs-local" }).rows[0].differences,
    ["loser.body.error.message:value"],
  );
  const both = runOf({ client: "10", server: "20" }, [
    publish("race-a", "13"),
    publish("race-b", "14"),
  ]);
  assert.equal(
    compareRuns(production, both, { kind: "production-vs-local" }).rows[0].status,
    "UNKNOWN",
  );
  const other = runOf({ client: "10", server: "20" }, [
    publish("race-a", "13"),
    refusal("race-b", 404, "NOT_FOUND"),
  ]);
  assert.equal(
    compareRuns(production, other, { kind: "production-vs-local" }).rows[0].differences[0],
    "loser",
  );
  const conflict = runOf({ client: "10", server: "20" }, [
    publish("race-a", "13"),
    refusal("race-b", 409, "FAILED_PRECONDITION"),
  ]);
  assert.equal(
    compareRuns(production, conflict, { kind: "production-vs-local" }).rows[0].differences[0],
    "loser",
  );
  const wrongVersion = runOf({ client: "10", server: "20" }, [
    publish("race-a", "14"),
    refusal("race-b", 400, "INVALID_ARGUMENT"),
  ]);
  assert.ok(
    compareRuns(production, wrongVersion, {
      kind: "production-vs-local",
    }).rows[0].differences.includes("winner.body.version.versionNumber:value"),
  );
  assert.deepEqual(RACE, ["p7-race-a", "p7-race-b"]);
});

test("escapes follow the history entries the projection keeps (ruling 5)", () => {
  const history = (versions, escapes) =>
    answer("h-client-history", `${CLIENT}:listVersions`, { versions }, { escapes });
  // A baseline entry at index 0 (dropped) and a retained entry at index 1 on one side; the
  // retained entry first on the other.
  const left = runOf({ client: "27", server: "6" }, [
    history([{ versionNumber: "27" }, { versionNumber: "28", description: "a<b" }], {
      "value:/versions/1/description": [[1, "\\u003c"]],
    }),
  ]);
  const same = runOf({ client: "10", server: "20" }, [
    history([{ versionNumber: "11", description: "a<b" }], {
      "value:/versions/0/description": [[1, "\\u003c"]],
    }),
  ]);
  const removed = runOf({ client: "10", server: "20" }, [
    history([{ versionNumber: "11", description: "a<b" }], {}),
  ]);
  assert.notEqual(
    compareRuns(left, same, { kind: "production-vs-local" }).rows[0].status,
    "MISMATCH",
  );
  assert.deepEqual(
    compareRuns(left, removed, { kind: "production-vs-local" }).rows[0].differences,
    ["escapes:value:/versions/0/description"],
  );
});

test("an event id of 0 is not a production id (ruling 5)", () => {
  const versions = [{ namespace: "client", step: "c0", versionNumber: "28", updateTime: "t" }];
  const event = (eventId) => ({
    generation: 1,
    eventId,
    versionNumber: "28",
    updateTime: "t",
    data: {},
    context: { eventId },
  });
  const run = (eventId) => ({
    baseline: { client: { version: "27" }, server: { version: "6" } },
    rows: [],
    versions,
    events: [event(eventId)],
  });
  assert.equal(
    compareRuns(run("929360796"), run("0"), { kind: "production-vs-local" }).rows[0].status,
    "MISMATCH",
  );
});

test("escapes of a dropped history entry are not compared (ruling 5)", () => {
  const history = (versions, escapes) =>
    answer("h-client-history", `${CLIENT}:listVersions`, { versions }, { escapes });
  const left = runOf({ client: "27", server: "6" }, [
    history(
      [
        { versionNumber: "27", description: "a<b" },
        { versionNumber: "28", description: "a<b" },
      ],
      { "value:/versions/0/description": [[1, "\\u003c"]] },
    ),
  ]);
  const right = runOf({ client: "10", server: "20" }, [
    history([{ versionNumber: "11", description: "a<b" }], {}),
  ]);
  assert.notEqual(
    compareRuns(left, right, { kind: "production-vs-local" }).rows[0].status,
    "MISMATCH",
  );
});

test("timeForm: protobuf digits or no trailing zeros, by the field's kind", async () => {
  const { timeForm } = await import("./judge.mjs");
  for (const [fraction, proto, minimal] of [
    ["", true, true],
    ["949", true, true],
    ["370", true, false],
    ["193490", true, false],
    ["408063", true, true],
    ["19349", false, true],
    ["12", false, true],
    ["250000", false, false],
    ["000", false, false],
    ["773004124", true, true],
    ["773004000", false, false],
  ]) {
    assert.equal(timeForm(fraction, "proto") === "ok", proto, `proto ${fraction}`);
    assert.equal(timeForm(fraction, "minimal") === "ok", minimal, `minimal ${fraction}`);
  }
});

test("instant reads a time whatever its fraction digits; events match their version by it", async () => {
  const { instant } = await import("./judge.mjs");
  assert.equal(instant("2026-11-24T23:15:00.19349Z"), instant("2026-11-24T23:15:00.193490Z"));
  assert.equal(instant("2026-11-24T23:15:08.949Z"), instant("2026-11-24T23:15:08.949000Z"));
  assert.equal(instant("2026-11-24T23:15:08Z"), instant("2026-11-24T23:15:08.000Z"));
  assert.notEqual(instant("2026-11-24T23:15:08.949Z"), instant("2026-11-24T23:15:08.948Z"));
  // The full instant (ruling 11 item 2): a nanosecond apart is another time.
  assert.notEqual(
    instant("2026-11-24T23:15:08.123456789Z"),
    instant("2026-11-24T23:15:08.123456Z"),
  );
  assert.notEqual(instant("2026-11-24T23:15:08.120000001Z"), instant("2026-11-24T23:15:08.12Z"));
  assert.equal(instant("2026-11-24T23:15:08.120Z"), instant("2026-11-24T23:15:08.12Z"));
  assert.equal(instant("2026-11-24T23:15:08.1234567890Z"), null);
  assert.equal(instant("2026-11-24T23:15:08.949+00:00"), null);
  assert.equal(instant(undefined), null);
});

test("eventRows: the summary counts repeated steps, server steps and arrival order", () => {
  const versions = [
    {
      namespace: "client",
      step: "p1",
      versionNumber: "28",
      updateTime: "2026-11-24T23:15:00.193490Z",
    },
    {
      namespace: "client",
      step: "p5",
      versionNumber: "29",
      updateTime: "2026-11-24T23:15:01.000000Z",
    },
    { namespace: "server", step: "s1", versionNumber: "10", updateTime: "2026-11-24T23:15:02.5Z" },
  ];
  const event = (generation, order, versionNumber, updateTime) => ({
    generation,
    order,
    eventId: `${versionNumber}`,
    versionNumber,
    updateTime,
    data: {},
    context: {},
  });
  const rows = eventRows({
    baseline: { client: { version: "27" }, server: { version: "9" } },
    versions,
    events: [
      // Gen1 names p1 with the trailing zero dropped, and p5 on a whole second.
      event(1, 1, "29", "2026-11-24T23:15:01Z"),
      event(1, 0, "28", "2026-11-24T23:15:00.19349Z"),
      event(1, 2, "28", "2026-11-24T23:15:00.19349Z"),
      event(2, 0, "29", "2026-11-24T23:15:01.000Z"),
      event(2, 1, "10", "2026-11-24T23:15:02.500Z"),
    ],
  });
  assert.deepEqual(rows.get("summary:g1").value, {
    clientSteps: ["p1", "p5"],
    serverSteps: [],
    duplicates: 1,
    unmatched: 0,
    inPublicationOrder: true,
  });
  assert.deepEqual(rows.get("summary:g2").value, {
    clientSteps: ["p5"],
    serverSteps: ["s1"],
    duplicates: 0,
    unmatched: 0,
    inPublicationOrder: true,
  });
  const reversed = eventRows({
    baseline: { client: { version: "27" }, server: { version: "9" } },
    versions,
    events: [
      event(1, 0, "29", "2026-11-24T23:15:01Z"),
      event(1, 1, "28", "2026-11-24T23:15:00.19349Z"),
    ],
  });
  assert.equal(reversed.get("summary:g1").value.inPublicationOrder, false);
  assert.deepEqual(reversed.get("summary:g1").value.clientSteps, ["p5", "p1"]);
});

test("forgery r3-4: an escape under a member named like the suffix is never waived", async () => {
  const { escapeMap } = await import("./sanitise.mjs");
  const left = '{"a:member-order":"\\u0078","b:member-order":"y"}';
  const right = '{"a:member-order":"x","b:member-order":"\\u0079"}';
  const run = (raw) =>
    runOf({ client: "27", server: "6" }, [
      answer("r-identity", CLIENT, JSON.parse(raw), { escapes: escapeMap(raw) }),
    ]);
  for (const [kind, known] of [
    ["production-vs-local", [MEMBER_ORDER]],
    [
      "production-vs-production",
      [
        {
          ...MEMBER_ORDER,
          id: "KD-PRODUCTION-MEMBER-ORDER",
          appliesTo: ["production-vs-production"],
        },
      ],
    ],
  ]) {
    const row = compareRuns(run(left), run(right), { known, kind }).rows[0];
    assert.equal(row.status, "MISMATCH", kind);
    assert.deepEqual(row.knownDifferences, [], kind);
  }
});
