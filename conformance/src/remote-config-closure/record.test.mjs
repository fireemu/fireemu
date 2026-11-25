import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_EXPRESSIONS,
  DEFAULTS,
  READS,
  clientDraft,
  conditionDrafts,
  historyQueries,
  validationDrafts,
} from "./corpus.mjs";
import {
  MAX_REQUESTS,
  closureForms,
  main,
  newHistoryGrants,
  validTime,
  raceWinner,
  summarise,
  templateUrls,
} from "./record.mjs";

// A synthetic project and number (never a sandbox value).
const PROJECT = "synthetic-sandbox";
const NUMBER = "123456789012";
const RC = "https://firebaseremoteconfig.googleapis.com/v1/";

const allow = closureForms({ project: PROJECT, number: NUMBER });
const url = (path) => new URL(path, RC);

test("closureForms admits exactly the corpus's Remote Config forms on the API host", () => {
  const client = `projects/${PROJECT}/remoteConfig`;
  for (const [method, path] of [
    ["GET", client],
    ["GET", `projects/${PROJECT}/namespaces/firebase/remoteConfig`],
    ["GET", `projects/${PROJECT}/namespaces/fireemu-absent-ns/remoteConfig`],
    ["GET", `projects/${NUMBER}/remoteConfig`],
    ["GET", `${client}?versionNumber=0`],
    ["GET", `${client}?versionNumber=27`],
    ["GET", `${client}?version_number=27`],
    ["GET", `${client}?versionNumber=9223372036854775807`],
    ["GET", `${client}?versionNumber=invalid`],
    ["PUT", `${client}?validateOnly=true`],
    ...DEFAULTS.map(([, path]) => ["GET", `projects/${PROJECT}/${path}`]),
  ])
    assert.ok(allow(url(path), method), `${method} ${path}`);
  // History queries are granted by the pass as it plans them (ruling 7): none is admitted unplanned.
  for (const search of [
    "pageSize=2",
    "pageSize=2&pageToken=31",
    "endVersionNumber=-1",
    "startTime=2026-11-25T01%3A02%3A03.456789Z",
    "endTime=2000-01-01T00%3A00%3A00Z",
    "startTime=invalid",
    "pageToken=fireemu-invalid",
  ])
    assert.equal(allow(url(`${client}:listVersions?${search}`), "GET"), false, search);
  for (const [method, path, base] of [
    ["GET", `projects/other-project/remoteConfig`],
    ["GET", `projects/123456789013/remoteConfig`],
    ["DELETE", client],
    ["PUT", `projects/${NUMBER}/remoteConfig`],
    ["GET", `${client}?versionNumber=1&x=2`],
    ["GET", `${client}?versionNumber=01`],
    ["GET", `${client}:listVersions?pageSize=3`],
    ["GET", `${client}:listVersions?pageToken=abc`],
    ["GET", `${client}:listVersions?startTime=2026-11-25T01:02:03Z`],
    [
      "GET",
      `${client}:listVersions?endTime=2026-11-25T01%3A02%3A03Z&startTime=2026-11-25T01%3A02%3A03Z`,
    ],
    ["GET", `projects/${PROJECT}/remoteConfig:downloadDefaults?format=YAML`],
    ["GET", client, "https://example.com/v1/"],
    ["GET", client, "http://firebaseremoteconfig.googleapis.com/v1/"],
    ["GET", client, "https://firebaseremoteconfig.googleapis.com:8443/v1/"],
    ["GET", client, "https://user@firebaseremoteconfig.googleapis.com/v1/"],
    ["PUT", `${client}?versionNumber=27`],
    ["POST", `${client}:listVersions?pageSize=2`],
  ])
    assert.ok(!allow(new URL(path, base ?? RC), method), `${method} ${path} ${base ?? ""}`);
});

test("the corpus holds every recorded client expression once and the recorded drafts", () => {
  assert.equal(CLIENT_EXPRESSIONS.length, 47);
  assert.equal(new Set(CLIENT_EXPRESSIONS.map(([name]) => name)).size, CLIENT_EXPRESSIONS.length);
  const drafts = [...validationDrafts(), ...conditionDrafts()];
  assert.equal(new Set(drafts.map(([name]) => name)).size, drafts.length);
  assert.equal(drafts.length, 29 + 47);
  for (const [, body] of conditionDrafts()) assert.equal(body.conditions[0].name, "fireemu_match");
  assert.deepEqual(Object.keys(clientDraft("first", "r").parameters), [
    "fireemu_source",
    "fireemu_count",
    "fireemu_json",
    "fireemu_bool",
    "fireemu_inapp",
    "fireemu_only_conditional",
  ]);
  assert.equal(READS.length, 11);
});

test("historyQueries moves a time by one microsecond across second boundaries", () => {
  const queries = Object.fromEntries(
    historyQueries({
      times: [
        "2026-11-25T00:00:00.999999Z",
        "2026-11-25T00:00:01.000000Z",
        "2026-11-25T00:00:01.500000Z",
      ],
      end: "31",
    }),
  );
  assert.deepEqual(queries["h-start-plus"], { startTime: "2026-11-25T00:00:01.000001Z" });
  assert.deepEqual(queries["h-end-minus"], { endTime: "2026-11-25T00:00:00.999999Z" });
  assert.deepEqual(queries["h-end-version"], { endVersionNumber: "31" });
  // A recorded time may have fewer than six fraction digits.
  const short = Object.fromEntries(
    historyQueries({ times: ["t", "2026-11-25T00:00:01.5Z", "t"], end: "1" }),
  );
  assert.deepEqual(short["h-start-plus"], { startTime: "2026-11-25T00:00:01.500001Z" });
  assert.deepEqual(queries["h-window"], {
    startTime: "2026-11-25T00:00:00.999999Z",
    endTime: "2026-11-25T00:00:01.500000Z",
  });
  assert.equal(Object.keys(queries).length, 16);
  // A time on a whole second has no fraction (ruling 7, note N4).
  const whole = Object.fromEntries(
    historyQueries({ times: ["t", "2026-11-25T00:00:14Z", "t"], end: "1" }),
  );
  assert.deepEqual(whole["h-start-plus"], { startTime: "2026-11-25T00:00:14.000001Z" });
  assert.deepEqual(whole["h-end-minus"], { endTime: "2026-11-25T00:00:13.999999Z" });
  // Every query the corpus builds is admitted once it is planned, and only once.
  const history = newHistoryGrants();
  const planned = closureForms({ project: PROJECT, number: NUMBER, history });
  const listed = (query) =>
    url(`projects/${PROJECT}/remoteConfig:listVersions?${new URLSearchParams(query)}`);
  for (const query of Object.values(queries)) {
    assert.equal(planned(listed(query), "GET"), false, JSON.stringify(query));
    history.plan(`?${new URLSearchParams(query)}`);
  }
  for (const query of Object.values(queries)) {
    assert.ok(planned(listed(query), "GET"), JSON.stringify(query));
    assert.equal(planned(listed(query), "GET"), false, `replayed ${JSON.stringify(query)}`);
  }
});

test("history grants: only planned, valid times, the received token once (ruling 7 item 1)", () => {
  const history = newHistoryGrants();
  const allow = closureForms({ project: PROJECT, number: NUMBER, history });
  const list = (search) => url(`projects/${PROJECT}/remoteConfig:listVersions${search}`);
  // A numeric token, a planned-looking time and an impossible time are refused unplanned.
  for (const search of [
    "?pageSize=2&pageToken=31",
    "?startTime=2026-11-25T01%3A02%3A03.456789Z",
    "?startTime=2026-02-30T01%3A02%3A03Z",
    "?pageSize=2",
  ])
    assert.equal(allow(list(search), "GET"), false, search);
  // An impossible time cannot be planned.
  for (const time of [
    "2026-02-30T00:00:00Z",
    "2026-11-25T24:00:00Z",
    "2026-11-25T00:60:00Z",
    "2026-13-01T00:00:00Z",
    "2026-11-25T00:00:00.1234567890Z",
    "2026-11-25 00:00:00Z",
  ])
    assert.throws(
      () => history.plan(`?${new URLSearchParams({ startTime: time })}`),
      /RFC 3339/,
      time,
    );
  history.plan("?startTime=invalid");
  assert.ok(allow(list("?startTime=invalid"), "GET"));
  // The next page: only the token granted, once, and not a different number.
  history.plan(`?${new URLSearchParams({ pageSize: "2", pageToken: "31" })}`);
  assert.equal(allow(list("?pageSize=2&pageToken=30"), "GET"), false);
  assert.ok(allow(list("?pageSize=2&pageToken=31"), "GET"));
  assert.equal(allow(list("?pageSize=2&pageToken=31"), "GET"), false);
  // Granted queries are bound to the host and method.
  history.plan("?pageSize=2");
  assert.equal(allow(list("?pageSize=2"), "POST"), false);
  assert.equal(
    allow(
      new URL(
        `projects/${PROJECT}/remoteConfig:listVersions?pageSize=2`,
        "https://example.com/v1/",
      ),
      "GET",
    ),
    false,
  );
  assert.ok(allow(list("?pageSize=2"), "GET"));
});

test("validTime: real calendar instants in RFC 3339 UTC only", () => {
  for (const time of [
    "2026-11-25T00:00:00Z",
    "2024-02-29T23:59:59.999999Z",
    "2026-11-25T01:02:03.1Z",
  ])
    assert.ok(validTime(time), time);
  for (const time of [
    "2025-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-11-25T00:00:00",
    "2026-11-25T00:00:00+00:00",
    "invalid",
    "",
  ])
    assert.equal(validTime(time), false, time);
});

test("main never sends to production without the flag, and local needs its number", async () => {
  await assert.rejects(
    main(["--target", "production", "--out", "/nonexistent/rc-closure-test"]),
    /production needs --send-production/,
  );
  await assert.rejects(
    main(
      [
        "--target",
        "local",
        "--base",
        "http://127.0.0.1:1/v1/",
        "--project",
        "p",
        "--events-file",
        "/nonexistent/e",
        "--out",
        "/nonexistent/rc-closure-test-2",
      ],
      { FIREEMU_CONTROL_TOKEN: "t" },
    ),
    /FIREEMU_LOCAL_PROJECT_NUMBER/,
  );
  await assert.rejects(
    main(["--target", "local", "--send-production", "--out", "/nonexistent/rc-closure-test-3"]),
    /for the production target only/,
  );
  await assert.rejects(
    main(["--target", "elsewhere", "--out", "/nonexistent/rc-closure-test-4"]),
    /--target must be local or production/,
  );
});

test("templateUrls names the numbered read only with a number", () => {
  const urls = templateUrls(RC, PROJECT, NUMBER);
  assert.equal(urls.numbered, `${RC}projects/${NUMBER}/remoteConfig`);
  assert.equal(templateUrls(RC, PROJECT, undefined).numbered, null);
  assert.equal(
    urls.dataPlane,
    `${RC}projects/${PROJECT}/namespaces/firebase-server/serverRemoteConfig`,
  );
});

test("summarise: server delivery is evidence only after the first client publication reached the handler", () => {
  const versions = [
    { namespace: "client", step: "p1", versionNumber: "28", updateTime: "t1" },
    { namespace: "server", step: "s1", versionNumber: "7", updateTime: "t2" },
  ];
  const event = (generation, versionNumber, updateTime, eventId) => ({
    generation,
    versionNumber,
    updateTime,
    eventId,
  });
  const delivered = summarise({ events: [event(1, "28", "t1", "1")], versions });
  assert.equal(delivered.generations[1].serverDelivery, "none-within-window");
  assert.equal(delivered.generations[2].serverDelivery, "not-evidence");
  assert.equal(
    summarise({ events: [event(1, "28", "t1", "1")], versions, truncated: true }).generations[1]
      .serverDelivery,
    "unknown-truncated-log-read",
  );
  const twice = summarise({
    events: [event(1, "28", "t1", "1"), event(1, "28", "t1", "1")],
    versions,
  });
  assert.deepEqual(twice.generations[1].duplicates, [{ eventId: "1", count: 2 }]);
  const server = summarise({
    events: [event(1, "28", "t1", "1"), event(1, "7", "t2", "2")],
    versions,
  });
  assert.equal(server.generations[1].serverDelivery, "delivered");
  const overlap = summarise({
    events: [event(1, "28", "t1", "1")],
    versions: [
      ...versions,
      { namespace: "server", step: "s4", versionNumber: "28", updateTime: "t3" },
    ],
  });
  assert.equal(overlap.generations[1].serverDelivery, "not-evidence");
});

test("the request cap covers the local corpus with the recorded production overheads", () => {
  // 167 requests in the local run (2026-11-25), plus the deploy, readiness, window and cleanup
  // requests RC-OBSERVE-V2-3 made around its corpus (101 total, 42 Remote Config).
  assert.ok(167 + (101 - 42) + 4 * 11 <= MAX_REQUESTS);
});

test("the transport sends the closure request options and keeps text bodies only when asked", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Transport, Unknown } = await import("../remote-config-observe/transport.mjs");
  const out = mkdtempSync(join(tmpdir(), "rc-closure-transport-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const seen = [];
  const reply = { status: 200, body: "<x/>" };
  const transport = new Transport({
    out,
    allow: () => true,
    token: () => "secret",
    maxRequests: 20,
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      seen.push(init.headers);
      return new Response(reply.body, {
        status: reply.status,
        headers: { "content-type": "application/xml" },
      });
    },
  });
  await assert.rejects(transport.send("plain", "https://example.test/x"), Unknown);
  assert.equal(seen.at(-1).authorization, "Bearer secret");
  assert.equal(seen.at(-1)["accept-encoding"], "gzip");
  assert.equal(seen.at(-1)["if-none-match"], undefined);
  const text = await transport.send("text", "https://example.test/x", {
    textBody: true,
    credentials: false,
    gzip: false,
    ifNoneMatch: "etag-1-2",
  });
  assert.equal(text.json, null);
  assert.equal(text.text, "<x/>");
  assert.equal(seen.at(-1).authorization, undefined);
  assert.equal(seen.at(-1)["accept-encoding"], "identity");
  assert.equal(seen.at(-1)["if-none-match"], "etag-1-2");
  reply.status = 400;
  await assert.rejects(
    transport.send("text-refused", "https://example.test/x", { textBody: true }),
    Unknown,
  );
  reply.status = 299;
  reply.body = "<y/>";
  assert.equal(
    (await transport.send("text-299", "https://example.test/x", { textBody: true })).json,
    null,
  );
  reply.status = 200;
  reply.body = "{}";
  assert.deepEqual(
    (await transport.send("json", "https://example.test/x", { textBody: true })).json,
    {},
  );
  const { readFileSync } = await import("node:fs");
  const journal = readFileSync(join(out, "journal.jsonl"), "utf8");
  assert.ok(
    journal.includes('"credentials":false') &&
      journal.includes('"gzip":false') &&
      journal.includes('"ifNoneMatch":"etag-1-2"'),
  );
  assert.ok(!journal.includes("secret"));
});

test("raceWinner: exactly one accepted publication, an unknown answer opened", () => {
  const ok = { status: "fulfilled", value: { status: 200, json: {} } };
  const refused = { status: "fulfilled", value: { status: 400, json: {} } };
  assert.equal(raceWinner([ok, refused], []), ok.value);
  assert.equal(raceWinner([refused, ok], []), ok.value);
  assert.throws(() => raceWinner([ok, ok], []), /2 publications accepted/);
  assert.throws(() => raceWinner([refused, refused], []), /0 publications accepted/);
  const open = [];
  assert.throws(
    () => raceWinner([refused, { status: "rejected", reason: new Error("unknown") }], open),
    /unknown/,
  );
  assert.deepEqual(open, ["p7-race-b: unknown client write (A2 reads client)"]);
});

test("summarise counts unmatched events and the publication order", () => {
  const versions = [
    { namespace: "client", step: "p1", versionNumber: "28", updateTime: "t1" },
    { namespace: "client", step: "p5", versionNumber: "29", updateTime: "t2" },
  ];
  const event = (versionNumber, updateTime, eventId) => ({
    generation: 1,
    versionNumber,
    updateTime,
    eventId,
  });
  const out = summarise({
    events: [event("29", "t2", "2"), event("28", "t1", "1"), event("99", "t9", "9")],
    versions,
  });
  assert.equal(out.generations[1].unmatched, 1);
  assert.equal(out.generations[1].inPublicationOrder, false);
  assert.deepEqual(out.generations[1].clientSteps, ["p5", "p1"]);
  assert.equal(
    summarise({ events: [event("28", "t1", "1"), event("29", "t2", "2")], versions }).generations[1]
      .inPublicationOrder,
    true,
  );
});

test("the request cap is taken before the first await: two concurrent sends at one slot (ruling 7 item 3)", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Transport } = await import("../remote-config-observe/transport.mjs");
  const out = mkdtempSync(join(tmpdir(), "rc-closure-cap-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  let fetched = 0;
  const transport = new Transport({
    out,
    allow: () => true,
    // The token is asynchronous, as the ADC token read is a yield point.
    token: async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "t";
    },
    maxRequests: 3,
    timeoutMs: 1000,
    fetchImpl: async () => {
      fetched += 1;
      return Response.json({});
    },
  });
  await transport.send("one", "https://example.test/a");
  await transport.send("two", "https://example.test/a");
  const both = await Promise.allSettled([
    transport.send("three", "https://example.test/a"),
    transport.send("four", "https://example.test/a"),
  ]);
  assert.deepEqual(
    both.map((o) => o.status),
    ["fulfilled", "rejected"],
  );
  assert.match(both[1].reason.message, /four: request cap reached/);
  assert.equal(transport.count, 3);
  assert.equal(fetched, 3);
});

test("summarise matches a Gen1 event whose time drops trailing zeros", async () => {
  const { nanosOf } = await import("./record.mjs");
  const versions = [
    {
      namespace: "client",
      step: "p1",
      versionNumber: "33",
      updateTime: "2026-11-24T23:15:00.193490Z",
    },
    { namespace: "client", step: "p5", versionNumber: "34", updateTime: "2026-11-24T23:15:01Z" },
  ];
  const events = [
    { generation: 1, eventId: "1", versionNumber: "33", updateTime: "2026-11-24T23:15:00.19349Z" },
    { generation: 1, eventId: "2", versionNumber: "34", updateTime: "2026-11-24T23:15:01.000Z" },
    { generation: 1, eventId: "3", versionNumber: "34", updateTime: "2026-11-24T23:15:01.001Z" },
  ];
  const g = summarise({ events, versions }).generations[1];
  assert.deepEqual(g.clientSteps, ["p1", "p5"]);
  assert.equal(g.unmatched, 1);
  assert.equal(nanosOf("2026-11-24T23:15:01+00:00"), null);
  // The full instant: one nanosecond apart is another time (ruling 11 item 2).
  assert.notEqual(nanosOf("2026-11-24T23:15:01.120Z"), nanosOf("2026-11-24T23:15:01.120000001Z"));
  assert.equal(nanosOf("2026-11-24T23:15:01.120Z"), nanosOf("2026-11-24T23:15:01.12Z"));
});
