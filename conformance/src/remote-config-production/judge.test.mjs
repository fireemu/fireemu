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
      updateTime: "t:6:Z",
      description: "r:1",
      nextPageToken: "v:-3",
      other: "s:30",
    },
  );
  assert.equal(form({ rollbackSource: "0" }, "27").rollbackSource, "s:0");
  assert.equal(form({ updateTime: "2026-01-01T00:00:00Z" }, "1").updateTime, "t:0:Z");
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
  assert.equal(idForm("929360796"), "id:int32-positive");
  assert.equal(idForm("2147483648"), "id:other:10");
  assert.equal(idForm("-351892884"), "id:int32-negative");
  assert.equal(idForm("01"), "id:other:2");
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
    ["event:client:c0:g1", "event:client:c0:g2", "event-ids", "event-id:c0", "summary:g1"],
  );
  assert.deepEqual(rows.get("event-id:c0").value, { shared: true });
  assert.deepEqual(rows.get("summary:g1").value, { clientSteps: ["c0"], duplicates: 1 });
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
    history({ "/versions/1/description": [[1, "\\u003c"]] }),
  ]);
  const right = runOf({ client: "27", server: "6" }, [history({})]);
  assert.equal(compareRuns(left, right, { kind: "production-vs-local" }).rows[0].status, "MATCH");
  const inside = runOf({ client: "27", server: "6" }, [
    history({ "/versions/0/versionNumber": [[0, "\\u0032"]] }),
  ]);
  assert.deepEqual(
    compareRuns(inside, right, { kind: "production-vs-local" }).rows[0].differences,
    ["escapes:/versions/0/versionNumber"],
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
    "s:[VALIDATION_ERROR]: start_time [\u27e8t:6\u27e9] must be before end_time [\u27e8t:6\u27e9].",
  );
  assert.equal(
    form(
      {
        message:
          "end_time must be no earlier than 2026-08-22T07:28:37.612323Z [2000-01-01T00:00:00Z specified].",
      },
      "1",
    ).message,
    "s:end_time must be no earlier than \u27e8t:6\u27e9 [\u27e8t:0\u27e9 specified].",
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
    refusal("race-b", 400, "INVALID_ARGUMENT"),
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
  assert.deepEqual(
    compareRuns(production, other, { kind: "production-vs-local" }).rows[0].differences,
    ["loser"],
  );
  const conflict = runOf({ client: "10", server: "20" }, [
    publish("race-a", "13"),
    refusal("race-b", 409, "FAILED_PRECONDITION"),
  ]);
  assert.deepEqual(
    compareRuns(production, conflict, { kind: "production-vs-local" }).rows[0].differences,
    ["loser"],
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
