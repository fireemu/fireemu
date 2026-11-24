// The closure pass against a fake production (RC-CLOSURE-A ruling 7, note N3): an in-memory
// Remote Config with the recorded precondition answers, stub Cloud Functions and logs, and answers
// lost on chosen cases. Nothing leaves the process.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Transport, Unknown } from "../remote-config-observe/transport.mjs";
import { closureForms, newHistoryGrants, observe, templateUrls } from "./record.mjs";

const PROJECT = "synthetic-sandbox";
const NUMBER = "123456789012";
const RC = "https://firebaseremoteconfig.googleapis.com/v1/";

/** An in-memory Remote Config of two namespaces, answering as the 2026-11-21 recordings. */
function remoteConfig({ client = 27, server = 6, status = {} } = {}) {
  const spaces = {};
  for (const [name, start] of [
    ["client", client],
    ["server", server],
  ]) {
    const history = new Map([[start, {}]]);
    spaces[name] = { version: start, history };
  }
  let clock = Date.parse("2026-11-25T00:00:00Z");
  const tag = (v) => `etag-${NUMBER}-${v}`;
  const json = (code, body, etag) =>
    new Response(JSON.stringify(body), {
      status: code,
      headers: { "content-type": "application/json; charset=UTF-8", ...(etag ? { etag } : {}) },
    });
  const template = (space, v = space.version) => ({
    ...space.history.get(v),
    version: { versionNumber: String(v), updateTime: new Date(clock).toISOString() },
  });
  const commit = (space, content) => {
    clock += 1250;
    space.version += 1;
    space.history.set(space.version, content);
    return json(200, template(space), tag(space.version));
  };
  return {
    spaces,
    async fetch(url, init) {
      const method = init.method;
      const path = url.pathname.replace(`/v1/projects/`, "");
      const forced = status[`${method} ${path}${url.search}`];
      if (forced) return json(forced, { error: { code: forced } });
      if (!init.headers.authorization) return json(401, { error: { code: 401 } });
      const [project, ...rest] = path.split("/");
      let route = rest.join("/");
      if (project !== PROJECT && !(project === NUMBER && route === "remoteConfig"))
        return json(404, { error: { code: 404 } });
      let name = "client";
      if (route.startsWith("namespaces/firebase-server/")) name = "server";
      else if (route.startsWith("namespaces/firebase/")) route = route.slice(20);
      else if (route.startsWith("namespaces/")) return json(400, { error: { code: 400 } });
      route = route.replace(/^namespaces\/firebase-server\//, "");
      const space = spaces[name];
      const query = url.searchParams;
      if (route === "serverRemoteConfig") return json(200, { conditions: [], parameters: {} });
      if (route === "remoteConfig:downloadDefaults")
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      if (route === "remoteConfig:listVersions") {
        const versions = [...space.history.keys()]
          .reverse()
          .map((v) => ({ versionNumber: String(v) }));
        const size = Number(query.get("pageSize") ?? 300);
        if (size === 2 && !query.get("pageToken"))
          return json(200, {
            versions: versions.slice(0, 2),
            nextPageToken: versions[2]?.versionNumber,
          });
        return json(200, { versions });
      }
      if (route === "remoteConfig:rollback") {
        const v = Number(JSON.parse(init.body).versionNumber);
        if (!space.history.has(v)) return json(404, { error: { code: 404 } });
        return commit(space, space.history.get(v));
      }
      if (route !== "remoteConfig") return json(404, { error: { code: 404 } });
      if (method === "GET") {
        const asked = query.get("versionNumber") ?? query.get("version_number");
        if (asked === null) return json(200, template(space), tag(space.version));
        const v = Number(asked);
        if (!space.history.has(v)) return json(404, { error: { code: 404 } });
        return json(200, template(space, v), tag(v));
      }
      const ifMatch = init.headers["if-match"];
      if (ifMatch === undefined) return json(400, { error: { code: 400 } });
      if (ifMatch !== "*" && !/^etag-[0-9]+-[0-9]+$/.test(ifMatch))
        return json(400, { error: { code: 400 } });
      if (ifMatch !== "*" && ifMatch !== tag(space.version))
        return json(412, { error: { code: 412 } });
      if (query.get("validateOnly") === "true") return json(200, template(space), tag(0));
      return commit(space, JSON.parse(init.body));
    },
  };
}

/** A transport whose answers to the cases in `lost` are lost after the request reached the fake. */
class LossyTransport extends Transport {
  constructor(options, lost) {
    super(options);
    this.lost = lost;
    this.sent = [];
  }
  async send(caseId, url, options) {
    this.sent.push(caseId);
    const answer = await super.send(caseId, url, options);
    if (this.lost.has(caseId)) {
      this.unknown.push(caseId);
      throw new Unknown(caseId, "answer lost (test)");
    }
    return answer;
  }
}

async function pass(t, { lost = [], status = {}, respond = () => null } = {}) {
  const out = mkdtempSync(join(tmpdir(), "rc-closure-fake-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const world = remoteConfig({ status });
  const services = new URL(
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services:batchGet`,
  );
  const repository = `https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/repositories/gcf-artifacts`;
  const iam = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`;
  const fetchImpl = async (url, init) => {
    if (url.host === "serviceusage.googleapis.com")
      return Response.json({
        services: [
          "firebaseremoteconfig",
          "cloudfunctions",
          "cloudbuild",
          "artifactregistry",
          "run",
          "eventarc",
          "logging",
        ].map((n) => ({ config: { name: `${n}.googleapis.com` }, state: "ENABLED" })),
      });
    if (url.host === "artifactregistry.googleapis.com")
      return Response.json({ cleanupPolicies: { "firebase-functions-cleanup": {} } });
    if (url.host === "cloudresourcemanager.googleapis.com") return Response.json({ bindings: [] });
    const forced = respond(url, init);
    if (forced instanceof Response) return forced;
    if (forced) return new Response(forced === 304 ? null : "{}", { status: forced });
    return world.fetch(url, init);
  };
  // History requests go through the pass's own grants, as in production (ruling 7 item 1).
  const history = newHistoryGrants();
  const forms = closureForms({ project: PROJECT, number: NUMBER, history });
  const allow = (url, method) =>
    !url.pathname.endsWith("/remoteConfig:listVersions") ||
    url.search === "?pageSize=8" ||
    forms(url, method);
  const transport = new LossyTransport(
    { out, allow, token: () => "t", maxRequests: 400, timeoutMs: 1000, fetchImpl },
    new Set(lost),
  );
  const functions = {
    names: { gen1: "rcObs1x", gen2: "rc-obs-2-x" },
    deployed: [],
    removed: [],
    open: [],
    state: {},
    grants: { managed: new Set(), source: null },
    async deploy(generation) {
      this.deployed.push(generation);
      return true;
    },
    async remove(generation) {
      this.removed.push(generation);
    },
    async removeSource() {},
  };
  const { result } = await observe({
    transport,
    history,
    urls: templateUrls(RC, PROJECT, NUMBER),
    runId: "261125000000abc",
    timing: { paceMs: 0, readyMs: 0, windowReads: 2, windowMs: 0, timeoutMs: 1000 },
    wait: async () => {},
    events: async () => ({ rows: [], truncated: false }),
    production: {
      functions,
      listFunctions: async () => [],
      google: { services: services.href, repository, iam, functions: "unused" },
    },
  });
  return { result, world, functions, sent: transport.sent };
}

test("fake production: the whole pass is complete and restores both namespaces", async (t) => {
  const { result, world, functions } = await pass(t);
  assert.equal(result.stopped, null);
  assert.deepEqual(result.open, []);
  assert.equal(result.complete, true);
  assert.deepEqual(functions.deployed, [1, 2]);
  assert.deepEqual(functions.removed, [2, 1]);
  assert.deepEqual(
    result.versions.map((v) => v.step),
    ["p1", "p5", "p6a", "p6b", "p7", "k1", "s1", "s4", "s5", "c9"],
  );
  assert.equal(world.spaces.client.history.get(world.spaces.client.version).parameters, undefined);
});

test("fake production: an unknown creating write is opened, stops, and G restores", async (t) => {
  const { result, world } = await pass(t, { lost: ["p1-publish"] });
  assert.match(result.stopped, /p1-publish: unknown answer/);
  assert.deepEqual(result.open, ["p1-publish: unknown client write (A2 reads client)"]);
  // G read the published template and rolled back to the baseline.
  assert.equal(result.baseline.after.client.empty, true);
  assert.deepEqual(world.spaces.client.history.get(world.spaces.client.version), {});
  assert.equal(result.complete, false);
});

test("fake production: an unknown write that cannot create stops with nothing opened", async (t) => {
  for (const caseId of ["p2-missing", "p3-stale", "p4-malformed", "k2-rollback-unknown"]) {
    const { result } = await pass(t, { lost: [caseId] });
    assert.match(result.stopped, new RegExp(`${caseId}: unknown answer`), caseId);
    assert.deepEqual(result.open, [], caseId);
    assert.equal(result.baseline.after.client.empty, true, caseId);
  }
});

test("fake production: an unknown validation is recorded and the pass goes on", async (t) => {
  const { result } = await pass(t, { lost: ["v-empty", "s-validate-03"] });
  assert.equal(result.stopped, null);
  assert.deepEqual(result.unknown, ["v-empty", "s-validate-03"]);
  assert.deepEqual(result.open, []);
  assert.equal(result.complete, false);
});

test("fake production: both race publications unknown are both open (ruling 7 item 2)", async (t) => {
  const { result } = await pass(t, { lost: ["p7-race-a", "p7-race-b"] });
  assert.deepEqual(result.open, [
    "p7-race-a: unknown client write (A2 reads client)",
    "p7-race-b: unknown client write (A2 reads client)",
  ]);
  assert.match(result.stopped, /p7-race-a: unknown answer/);
  assert.equal(result.baseline.after.client.empty, true);
});

test("fake production: a 429 on any creating write stops, s4 included (ruling 7 item 4)", async (t) => {
  const serverPut = (url, init) =>
    init.method === "PUT" &&
    url.pathname.endsWith("/namespaces/firebase-server/remoteConfig") &&
    url.search === "";
  // s1 (the first server publication) answers 429.
  let puts = 0;
  const s1 = await pass(t, {
    respond: (url, init) => (serverPut(url, init) && ++puts === 1 ? 429 : null),
  });
  assert.equal(s1.result.stopped, "s1-publish: 429");
  // s4 (the wildcard publication, the second) answers 429: nothing after it is sent.
  puts = 0;
  const s4 = await pass(t, {
    respond: (url, init) => (serverPut(url, init) && ++puts === 2 ? 429 : null),
  });
  assert.equal(s4.result.stopped, "s4-wildcard: 429");
  assert.equal(s4.sent.includes("s5-rollback"), false);
  assert.equal(s4.sent.includes("c9-restore"), false);
  // G restores the server namespace s1 published.
  assert.equal(s4.result.baseline.after.server.empty, true);
  assert.equal(s4.sent.includes("g-server-restore"), true);
  assert.equal(s4.result.complete, false);
  // A 429 on a validation creates nothing: recorded, and the pass goes on.
  let validations = 0;
  const validation = await pass(t, {
    respond: (url, init) =>
      init.method === "PUT" &&
      url.searchParams.get("validateOnly") === "true" &&
      ++validations === 4
        ? 429
        : null,
  });
  assert.equal(validation.result.stopped, null);
  assert.equal(validation.result.complete, true);
});

test("fake production: a complete 304 to the conditional read is an answer", async (t) => {
  const { result, sent } = await pass(t, {
    respond: (url, init) => (init.headers["if-none-match"] ? 304 : null),
  });
  assert.equal(result.stopped, null);
  assert.ok(sent.includes("v-before"));
  assert.deepEqual(result.unknown, []);
});

test("fake production: G rolls back only a namespace the pass wrote", async (t) => {
  // The pass stops at p1 (lost) before any server write; G then reads a server template that is
  // not empty (someone else's), which it must not roll back.
  let serverReads = 0;
  const { result, sent } = await pass(t, {
    lost: ["p1-publish"],
    respond: (url, init) =>
      init.method === "GET" &&
      url.pathname.endsWith("/namespaces/firebase-server/remoteConfig") &&
      ++serverReads > 1
        ? Response.json(
            {
              parameters: { foreign: { defaultValue: { value: "x" } } },
              version: { versionNumber: "7" },
            },
            { headers: { etag: "etag-123456789012-7" } },
          )
        : null,
  });
  assert.equal(sent.includes("g-server-restore"), false);
  assert.equal(sent.includes("g-client-restore"), true);
  assert.equal(result.baseline.after.server.empty, false);
  assert.equal(result.sandboxAtBaseline, false);
});

test("fake production: a 429 on either race publication stops before p8 (ruling 8)", async (t) => {
  for (const limited of [1, 2]) {
    // The race PUTs are the only client publications sent together; count the unvalidated client
    // PUTs: p1, p2, p3, p4, p5, p6a, p6b, then the two race publications (8th and 9th).
    let puts = 0;
    const { result, sent } = await pass(t, {
      respond: (url, init) =>
        init.method === "PUT" &&
        url.pathname.endsWith(`/v1/projects/${PROJECT}/remoteConfig`) &&
        url.search === "" &&
        ++puts === 7 + limited
          ? 429
          : null,
    });
    const caseId = limited === 1 ? "p7-race-a" : "p7-race-b";
    assert.equal(result.stopped, `${caseId}: 429`, caseId);
    assert.equal(sent.includes("p8-current"), false, caseId);
    assert.deepEqual(result.open, [], caseId);
    // G restores the client namespace the pass wrote.
    assert.ok(sent.includes("g-client-restore"), caseId);
    assert.equal(result.baseline.after.client.empty, true, caseId);
    assert.equal(result.complete, false, caseId);
  }
});

test("fake production: an unknown race publication beside a 429 stays open", async (t) => {
  let puts = 0;
  const { result } = await pass(t, {
    lost: ["p7-race-a"],
    respond: (url, init) =>
      init.method === "PUT" &&
      url.pathname.endsWith(`/v1/projects/${PROJECT}/remoteConfig`) &&
      url.search === "" &&
      ++puts === 9
        ? 429
        : null,
  });
  assert.deepEqual(result.open, ["p7-race-a: unknown client write (A2 reads client)"]);
  assert.match(result.stopped, /p7-race-a: unknown answer/);
  assert.equal(result.baseline.after.client.empty, true);
});
