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
import { MAX_REQUESTS, closureForms, main, summarise, templateUrls } from "./record.mjs";

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
    ["GET", `${client}:listVersions?pageSize=2`],
    ["GET", `${client}:listVersions?pageSize=2&pageToken=31`],
    ["GET", `${client}:listVersions?endVersionNumber=-1`],
    ["GET", `${client}:listVersions?startTime=2026-11-25T01%3A02%3A03.456789Z`],
    [
      "GET",
      `${client}:listVersions?startTime=2026-11-25T01%3A02%3A03.456789Z&endTime=2026-11-25T01%3A02%3A04.000001Z`,
    ],
    ["GET", `${client}:listVersions?endTime=2000-01-01T00%3A00%3A00Z`],
    ["GET", `${client}:listVersions?startTime=invalid`],
    ["GET", `${client}:listVersions?pageToken=fireemu-invalid`],
  ])
    assert.ok(allow(url(path), method), `${method} ${path}`);
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
  assert.deepEqual(queries["h-window"], {
    startTime: "2026-11-25T00:00:00.999999Z",
    endTime: "2026-11-25T00:00:01.500000Z",
  });
  assert.equal(Object.keys(queries).length, 16);
  // Every query the corpus builds is admitted.
  for (const query of Object.values(queries))
    assert.ok(
      allow(
        url(`projects/${PROJECT}/remoteConfig:listVersions?${new URLSearchParams(query)}`),
        "GET",
      ),
      JSON.stringify(query),
    );
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
