// RC-CLOSURE-B against a fake production: an in-memory Remote Config (admin and client fetch), a
// fake Installations service and a realtime stream that answers when a version is published, all
// behind the browser's request hook. Chromium runs the pinned Web SDK; nothing leaves the process.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { Transport, Unknown } from "../remote-config-observe/transport.mjs";
import { openBrowser } from "./driver.mjs";
import { observe } from "./program.mjs";

// The tests need Playwright's Chromium (`pnpm -C conformance exec playwright install chromium`);
// without it they are skipped, as in the conformance CI job, which installs no browser.
const skip = existsSync(chromium.executablePath()) ? false : "Playwright Chromium is not installed";
const PROJECT = "synthetic-web";
const NUMBER = "123456789012";
const KEY = "AIzaSyntheticKeyValue00000000000000000";
const ADMIN = `https://firebaseremoteconfig.googleapis.com/v1/projects/${PROJECT}/remoteConfig`;
const TIMING = {
  paceMs: 0,
  streamOpenMs: 10_000,
  updateWindowMs: 10_000,
  quietWindowMs: 1500,
  reconnectGapMs: 200,
  pollMs: 0,
  polls: 3,
};

/** The fake service: client template history, installations, pending realtime streams. */
function world({
  deleteFails = false,
  deleteHangs = false,
  fetchStatus = 200,
  echoKey = false,
  streamStatus = 200,
  streamStatusNow = null,
  project = PROJECT,
  onFetch = null,
  createFails = false,
  streamAfterPublish = null,
  fetchGarbage = false,
  putStatus = 200,
} = {}) {
  const ADMIN = `https://firebaseremoteconfig.googleapis.com/v1/projects/${project}/remoteConfig`;
  let streamCount = 0;
  const history = new Map([[27, {}]]);
  let version = 27;
  const pending = [];
  const fids = [];
  let fetchDispatches = 0;
  const publish = (content) => {
    version += 1;
    history.set(version, content);
    for (const resolve of pending.splice(0)) resolve(version);
    return version;
  };
  const json = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=UTF-8", ...headers },
    });
  const doc = (v = version) => ({ ...history.get(v), version: { versionNumber: String(v) } });
  /** The admin side, as fetch. */
  const admin = async (url, init) => {
    const method = init.method;
    if (url.href === ADMIN && method === "GET")
      return json(200, doc(), { etag: `etag-${NUMBER}-${version}` });
    if (url.href === ADMIN && method === "PUT" && putStatus !== 200)
      return json(putStatus, { error: { code: putStatus } });
    if (url.href === ADMIN && method === "PUT") {
      const tag = init.headers["if-match"];
      if (tag !== `etag-${NUMBER}-${version}` && tag !== "*")
        return json(412, { error: { code: 400 } });
      const body = JSON.parse(init.body);
      const { version: _v, ...content } = body;
      publish(content);
      return json(200, doc(), { etag: `etag-${NUMBER}-${version}` });
    }
    if (url.href === `${ADMIN}:rollback` && method === "POST") {
      const target = Number(JSON.parse(init.body).versionNumber);
      if (!history.has(target)) return json(404, { error: { code: 404 } });
      publish(history.get(target));
      return json(200, doc(), { etag: `etag-${NUMBER}-${version}` });
    }
    return json(404, { error: { code: 404 } });
  };
  const evaluate = (content, signals) => {
    const matches = {
      fireemu_premium: signals.fireemu_tier === "premium",
      fireemu_level: Number(signals.fireemu_level) >= 5,
      fireemu_half: false,
    };
    return Object.fromEntries(
      Object.entries(content.parameters ?? {})
        .filter(([, p]) => p.defaultValue?.value !== undefined || p.conditionalValues)
        .map(([key, p]) => {
          const hit = Object.entries(p.conditionalValues ?? {}).find(([c]) => matches[c]);
          return [key, hit ? hit[1].value : p.defaultValue?.value];
        })
        .filter(([, value]) => value !== undefined),
    );
  };
  /** The client side, as the browser hook's answer. */
  const client = async (request) => {
    const url = new URL(request.url());
    const expose = { "access-control-expose-headers": "etag" };
    if (url.host === "firebaseinstallations.googleapis.com") {
      if (request.method() === "DELETE" && deleteHangs) return new Promise(() => {});
      if (request.method() === "DELETE")
        return deleteFails
          ? {
              status: 403,
              headers: { "content-type": "application/json" },
              body: '{"error":{"code":403}}',
            }
          : { status: 200, headers: {}, body: "{}" };
      if (url.pathname.endsWith("/authTokens:generate"))
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "fake-auth-token-2", expiresIn: "604800s" }),
        };
      // Production returns the id the SDK generated (it is a secret as much as the tokens).
      const fid = JSON.parse(request.postData()).fid;
      fids.push(fid);
      // `createFails`: the create took effect but its answer is lost (a 503 to the SDK).
      if (createFails)
        return { status: 503, headers: { "content-type": "application/json" }, body: "{}" };
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `projects/${NUMBER}/installations/${fid}`,
          fid,
          refreshToken: `fake-refresh-${fids.length}`,
          authToken: { token: `fake-auth-token-${fids.length}`, expiresIn: "604800s" },
        }),
      };
    }
    if (url.pathname.endsWith(":fetch")) fetchDispatches += 1;
    if (url.pathname.endsWith(":fetch") && fetchStatus !== 200)
      return {
        status: fetchStatus,
        headers: { "content-type": "application/json" },
        body: '{"error":{"code":429}}',
      };
    if (url.pathname.endsWith(":fetch") && fetchGarbage)
      return { status: 200, headers: { "content-type": "application/json" }, body: "not json" };
    if (url.pathname.endsWith(":fetch")) {
      onFetch?.();
      const body = JSON.parse(request.postData());
      // `echoKey`: an answer that carries the key in a value and in its ETag.
      const key = url.searchParams.get("key");
      const tag = echoKey ? `etag-v${version}-${key}` : `etag-v${version}`;
      if (request.headers()["if-none-match"] === tag)
        return { status: 304, headers: { etag: tag, ...expose }, body: "" };
      return {
        status: 200,
        headers: { "content-type": "application/json", etag: tag, ...expose },
        body: JSON.stringify({
          entries: {
            ...evaluate(history.get(version), body.custom_signals ?? {}),
            // The key as a value and as a parameter name whose value changes with each version.
            ...(echoKey ? { fireemu_echo: key, [key]: String(version) } : {}),
          },
          state: "UPDATE",
          templateVersion: String(version),
        }),
      };
    }
    if (url.pathname.endsWith(":streamFetchInvalidations")) {
      streamCount += 1;
      const status = streamStatusNow?.() ?? (streamCount === 1 ? streamStatus : 200);
      if (status !== 200)
        return { status, headers: { "content-type": "application/json" }, body: "{}" };
    }
    if (url.pathname.endsWith(":streamFetchInvalidations")) {
      const next = await new Promise((resolve) => pending.push(resolve));
      // `streamAfterPublish`: the stream answers the publication with realtime disabled (a listener
      // error under a 200) or with a redirect (a failed request with no status).
      if (streamAfterPublish === "disabled")
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: '[{\n  "featureDisabled": true\n}',
        };
      if (streamAfterPublish === "429")
        return { status: 429, headers: { "content-type": "application/json" }, body: "{}" };
      if (streamAfterPublish === "redirect")
        return { status: 302, headers: { location: "https://elsewhere.example/x" }, body: "" };
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: `[{\n  "latestTemplateVersionNumber": "${next}"\n}`,
      };
    }
    return { status: 404, headers: {}, body: "" };
  };
  return { admin, client, fids, version: () => version, history, fetches: () => fetchDispatches };
}

test(
  "fake production: the pass fetches, listens, reconnects and restores; no secret leaves the page",
  { timeout: 120_000, skip },
  async (t) => {
    const out = mkdtempSync(join(tmpdir(), "rc-closure-b-fake-"));
    t.after(() => rmSync(out, { recursive: true, force: true }));
    const fake = world();
    const transport = new Transport({
      out,
      allow: () => true,
      token: () => "t",
      maxRequests: 60,
      timeoutMs: 5000,
      fetchImpl: fake.admin,
    });
    const browser = await openBrowser({ port: 47811, cap: 80, fake: fake.client });
    t.after(() => browser.close());
    const result = await observe({
      transport,
      browser,
      urls: { client: ADMIN },
      project: PROJECT,
      number: NUMBER,
      appId: `1:${NUMBER}:web:0000000000000000000000`,
      fakeKey: KEY,
      runId: "261125000000abc",
      timing: TIMING,
      production: false,
    });
    assert.equal(result.stopped, null, JSON.stringify(result.steps));
    assert.deepEqual(result.open, []);
    assert.equal(result.baseline.after.empty, true);
    assert.equal(result.complete, true);
    // Both installations fetched both signal sets; S1 took the premium values.
    assert.equal(result.clients.one.fetches[0].values.fireemu_message.value, "v1-premium");
    assert.equal(result.clients.two.fetches[0].values.fireemu_message.value, "v1-default");
    assert.equal(result.clients.one.fetches[0].values.fireemu_limit.value, "20");
    // The changed publication reached the listener; the reconnect opened a second stream.
    assert.ok(result.steps.find((s) => s.name === "r1-changed").updated);
    // Whether the SDK opens a new stream after the listener closes and reopens is recorded, not
    // required (`r-reopen`): the fake's stream answers once per publication.
    assert.equal(typeof result.steps.find((s) => s.name === "r-reopen").reopened, "boolean");
    assert.ok(result.steps.find((s) => s.name === "r5-changed").updated);
    const wire = result.clients.one.wire;
    const streamsSeen = wire.filter((e) => e.path.endsWith(":streamFetchInvalidations"));
    assert.ok(streamsSeen.some((e) => e.text?.includes("latestTemplateVersionNumber")));
    assert.ok(
      streamsSeen.every((e) =>
        (e.chunks ?? []).every((c) => typeof c.length === "number" && !("text" in c)),
      ),
    );
    // The key, the installation ids and every installation credential never leave the page.
    const text = JSON.stringify(result);
    for (const secret of [
      KEY,
      ...fake.fids,
      "fake-refresh-1",
      "fake-auth-token-1",
      "fake-auth-token-2",
    ])
      assert.ok(!text.includes(secret), secret);
    assert.ok(text.includes("API_KEY"));
    assert.ok(wire.some((e) => e.requestBody?.includes('"app_instance_id":"FID_1"')));
    // Both installations were deleted through the SDK.
    assert.equal(result.clients.one.deletion.deleted, true);
    assert.equal(result.clients.two.deletion.deleted, true);
    assert.ok(result.pageRequests <= 80);
    const journal = readFileSync(join(out, "journal.jsonl"), "utf8");
    assert.ok(!journal.includes(KEY));
  },
);

test(
  "fake production: an unknown template write is opened, stops the pass, and the baseline is restored",
  { timeout: 60_000, skip },
  async (t) => {
    const out = mkdtempSync(join(tmpdir(), "rc-closure-b-fake-"));
    t.after(() => rmSync(out, { recursive: true, force: true }));
    const fake = world();
    class Lossy extends Transport {
      async send(caseId, url, options) {
        const answer = await super.send(caseId, url, options);
        if (caseId === "r1-changed") {
          this.unknown.push(caseId);
          throw new Unknown(caseId, "answer lost (test)");
        }
        return answer;
      }
    }
    const transport = new Lossy({
      out,
      allow: () => true,
      token: () => "t",
      maxRequests: 60,
      timeoutMs: 5000,
      fetchImpl: fake.admin,
    });
    const browser = await openBrowser({ port: 47812, cap: 80, fake: fake.client });
    t.after(() => browser.close());
    const result = await observe({
      transport,
      browser,
      urls: { client: ADMIN },
      project: PROJECT,
      number: NUMBER,
      appId: `1:${NUMBER}:web:0000000000000000000000`,
      fakeKey: KEY,
      runId: "261125000000abd",
      timing: TIMING,
      production: false,
    });
    assert.match(result.stopped, /r1-changed: unknown answer/);
    assert.deepEqual(result.open, ["r1-changed: unknown client write (A2 reads client)"]);
    assert.equal(result.baseline.after.empty, true);
    assert.equal(result.complete, false);
  },
);

/** The production admin surfaces around the template: services, web apps and the API Keys service. */
function productionAdmin(
  fake,
  {
    keyLost = false,
    keyStaysLive = false,
    listStatus = 200,
    listNextPage = false,
    appsNextPage = false,
    createPollFailures = 0,
    createLost = false,
    keyProject = NUMBER,
    operationName = null,
    servicesNextPage = false,
    servicesExtra = false,
    listError = false,
    deleteTime = "2026-11-25T00:00:00Z",
    appNumber = NUMBER,
    readbackName = null,
    pollName = null,
    leakKeyInTemplate = false,
    createRefusal = null,
    deleteOpDeleteTime = null,
    readbackStatus = 200,
  } = {},
) {
  const keys = [];
  let createPolls = 0;
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  // Every API Keys answer but the lists carries the key in an ETag: a secret answer's headers are
  // never journaled.
  const keyed = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", etag: `"k-${KEY}"` },
    });
  return async (url, init) => {
    if (url.host === "serviceusage.googleapis.com")
      return json(200, {
        services: [
          ...url.searchParams.getAll("names"),
          ...(servicesExtra ? ["projects/x/services/other.googleapis.com"] : []),
        ].map((n) => ({
          name: `projects/${NUMBER}/services/${n.split("/").at(-1)}`,
          config: { name: n.split("/").at(-1) },
          state: "ENABLED",
        })),
        ...(servicesNextPage ? { nextPageToken: "more" } : {}),
      });
    if (url.host === "firebase.googleapis.com")
      return json(200, {
        apps: [{ displayName: "listen-l1", appId: `1:${appNumber}:web:0000000000000000000000` }],
        ...(appsNextPage ? { nextPageToken: "more" } : {}),
      });
    if (url.host === "apikeys.googleapis.com") {
      const path = url.pathname.slice("/v2/".length);
      if (init.method === "POST") {
        const name = `projects/${keyProject}/locations/global/keys/k${keys.length}`;
        keys.push({ name, displayName: JSON.parse(init.body).displayName });
        if (createLost) return keyed(500, {});
        // `createRefusal`: a definite 4xx, with Google's error body or another.
        if (createRefusal) {
          keys.pop();
          return keyed(createRefusal.status, createRefusal.body);
        }
        return keyed(200, {
          name: operationName ?? `operations/create-${keys.length}`,
          done: false,
        });
      }
      // A done operation carries the created key with its value, as the API Keys service answers.
      if (path.startsWith("operations/create-")) {
        createPolls += 1;
        if (createPolls <= createPollFailures) return keyed(503, {});
        return keyed(200, {
          name: pollName ?? path,
          done: true,
          response: { name: keys.at(-1).name, keyString: KEY, displayName: "rc-closure-b-sdk" },
        });
      }
      if (path.startsWith("operations/delete-"))
        return keyed(200, {
          name: path,
          done: true,
          response: {
            name: keys.at(-1).name,
            keyString: KEY,
            ...(deleteOpDeleteTime ? { deleteTime: deleteOpDeleteTime } : {}),
          },
        });
      if (path.endsWith("/keyString")) return keyed(200, { keyString: KEY });
      if (init.method === "DELETE") {
        if (!keyStaysLive) keys.find((k) => k.name === path).deleteTime = deleteTime;
        return keyLost
          ? keyed(500, {})
          : keyed(200, { name: `operations/delete-${keys.length}`, done: false });
      }
      if (
        url.search === "" &&
        path.startsWith("projects/") &&
        path.includes("/keys/") &&
        readbackStatus !== 200
      )
        return keyed(readbackStatus, {
          error: { code: readbackStatus, status: "NOT_FOUND", message: "x" },
        });
      if (url.search === "" && path.startsWith("projects/") && path.includes("/keys/"))
        return keyed(200, {
          ...keys.find((k) => k.name === path),
          ...(readbackName ? { name: readbackName } : {}),
        });
      if (listStatus !== 200) return json(listStatus, { error: { code: listStatus } });
      if (listError) return json(200, { error: { code: 500 } });
      return json(200, {
        keys: keys.filter((k) => url.search.includes("showDeleted") || !k.deleteTime),
        ...(listNextPage ? { nextPageToken: "more" } : {}),
      });
    }
    const answer = await fake.admin(url, init);
    // `leakKeyInTemplate`: a template answer that carries the key once it exists (the leak check
    // must find it in the journaled body).
    if (leakKeyInTemplate && keys.length && init.method === "GET") {
      const doc = await answer.json();
      return json(200, { ...doc, version: { ...doc.version, description: `leak ${KEY}` } });
    }
    return answer;
  };
}

test(
  "fake production with the API key: created, used, deleted and read back; its value never written",
  { timeout: 120_000, skip },
  async (t) => {
    const out = mkdtempSync(join(tmpdir(), "rc-closure-b-fake-"));
    t.after(() => rmSync(out, { recursive: true, force: true }));
    const fake = world();
    const grants = { operations: new Set(), key: null };
    const { productionAllow, PROJECT: SANDBOX, adminUrls } = await import("./record.mjs");
    const urls = { ...adminUrls(SANDBOX), client: ADMIN };
    const allow = productionAllow(SANDBOX, grants);
    const transport = new Transport({
      out,
      // The sandbox's own forms, with the synthetic project's template URLs.
      allow: (url, method) => url.href.startsWith(ADMIN) || allow(url, method),
      token: () => "t",
      maxRequests: 60,
      timeoutMs: 5000,
      fetchImpl: productionAdmin(fake),
    });
    const browser = await openBrowser({ port: 47813, cap: 80, fake: fake.client });
    t.after(() => browser.close());
    const result = await observe({
      transport,
      browser,
      urls,
      project: PROJECT,
      number: NUMBER,
      runId: "261125000000abe",
      timing: TIMING,
      production: true,
      grant: (kind, value) => {
        if (kind === "operation") grants.operations.add(value);
        if (kind === "key") grants.key = value;
      },
    });
    assert.equal(result.stopped, null, JSON.stringify(result.steps));
    assert.deepEqual(result.open, []);
    assert.equal(result.key.created, true);
    assert.equal(result.key.deleted, true);
    assert.equal(result.complete, true);
    const journal = readFileSync(join(out, "journal.jsonl"), "utf8");
    assert.ok(!journal.includes(KEY));
    assert.ok(!JSON.stringify(result).includes(KEY));
    const { readdirSync } = await import("node:fs");
    for (const file of readdirSync(out))
      assert.ok(!readFileSync(join(out, file), "utf8").includes(KEY), file);
    const valueRow = journal
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((r) => r.case === "k-value" && r.phase === "response-persisted");
    // A secret answer's row is its closed set: no digest and no header value (ruling 18 item 3).
    assert.deepEqual(Object.keys(valueRow).toSorted(), [
      "at",
      "bytes",
      "case",
      "file",
      "phase",
      "secret",
      "seq",
      "status",
    ]);
    assert.equal(valueRow.file, null);
  },
);

test(
  "fake production: a key that does not read deleted stays open",
  { timeout: 120_000, skip },
  async (t) => {
    const out = mkdtempSync(join(tmpdir(), "rc-closure-b-fake-"));
    t.after(() => rmSync(out, { recursive: true, force: true }));
    const fake = world();
    const grants = { operations: new Set(), key: null };
    const { productionAllow, PROJECT: SANDBOX, adminUrls } = await import("./record.mjs");
    const allow = productionAllow(SANDBOX, grants);
    const transport = new Transport({
      out,
      allow: (url, method) => url.href.startsWith(ADMIN) || allow(url, method),
      token: () => "t",
      maxRequests: 60,
      timeoutMs: 5000,
      fetchImpl: productionAdmin(fake, { keyLost: true }),
    });
    const browser = await openBrowser({ port: 47814, cap: 80, fake: fake.client });
    t.after(() => browser.close());
    const result = await observe({
      transport,
      browser,
      urls: { ...adminUrls(SANDBOX), client: ADMIN },
      project: PROJECT,
      number: NUMBER,
      runId: "261125000000abf",
      timing: TIMING,
      production: true,
      grant: (kind, value) => {
        if (kind === "operation") grants.operations.add(value);
        if (kind === "key") grants.key = value;
      },
    });
    assert.equal(result.key.deleted, false);
    assert.ok(
      result.open.some((item) => item.includes("A2 lists keys")),
      JSON.stringify(result.open),
    );
    assert.equal(result.complete, false);
  },
);

/** One production-path pass with the given world and admin options. */
async function productionPass(
  t,
  port,
  { admin = {}, client = {}, cap = 80, callTimeoutMs, number = NUMBER, hold, timing = TIMING } = {},
) {
  const out = mkdtempSync(join(tmpdir(), "rc-closure-b-fake-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const fake = world(typeof client === "function" ? client(out) : client);
  const grants = { operations: new Set(), key: null };
  const { productionAllow, PROJECT: SANDBOX, adminUrls } = await import("./record.mjs");
  const allow = productionAllow(SANDBOX, grants);
  const transport = new Transport({
    out,
    allow: (url, method) => url.href.startsWith(ADMIN) || allow(url, method),
    token: () => "t",
    maxRequests: 60,
    timeoutMs: 5000,
    fetchImpl: productionAdmin(fake, admin),
  });
  const browser = await openBrowser({
    port,
    cap,
    fake: fake.client,
    ...(callTimeoutMs ? { callTimeoutMs } : {}),
  });
  t.after(() => browser.close());
  hold?.(browser);
  const result = await observe({
    transport,
    browser,
    urls: { ...adminUrls(SANDBOX), client: ADMIN },
    project: PROJECT,
    number,
    runId: "261125000000abg",
    timing,
    production: true,
    grant: (kind, value) => {
      if (kind === "operation") grants.operations.add(value);
      if (kind === "key") grants.key = value;
    },
  });
  return Object.assign(result, { out, fake });
}

test(
  "fake production: a key whose read-back has no deleteTime stays open",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47815, { admin: { keyStaysLive: true } });
    assert.equal(result.key.deleted, false);
    // The key's item stays open (it was never proved deleted) beside the read-back's problem.
    assert.deepEqual(result.open, [
      "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      // A 200 read-back naming the key without a deleteTime shows it live (ruling 20).
      "k-readback: the key reads live after its deletion (A2 lists keys)",
    ]);
    assert.equal(result.sandboxAtBaseline, false);
    assert.equal(result.complete, false);
  },
);

test(
  "fake production: an installation the SDK cannot delete is an open item",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47816, { client: { deleteFails: true } });
    assert.equal(result.clients.one.deletion.deleted, false);
    assert.ok(
      result.open.includes("g-one: installation not deleted (unreadable afterwards; residue)"),
      JSON.stringify(result.open),
    );
    assert.equal(result.complete, false);
  },
);

test(
  "fake production: the page's request cap stops the pass and is recorded",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47817, { cap: 3 });
    assert.match(result.stopped, /browser: request cap 3|did not open|error/);
    assert.ok(
      result.refusals.some((r) => r.reason === "request cap"),
      JSON.stringify(result.refusals),
    );
    assert.equal(result.pageRequests, 3);
    assert.equal(result.complete, false);
  },
);

// ---- RC-CLOSURE-B v1.1 (ruling 16) ----

test(
  "v1.1 item 1: the key in the create and delete operations, an ETag and an SDK value never lands in a file",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47821, { client: { echoKey: true } });
    assert.equal(result.stopped, null, JSON.stringify(result.steps));
    assert.equal(result.key.deleted, true);
    const { readdirSync } = await import("node:fs");
    for (const file of readdirSync(result.out))
      assert.ok(!readFileSync(join(result.out, file), "utf8").includes(KEY), file);
    const text = JSON.stringify(result);
    assert.ok(!text.includes(KEY));
    // The SDK's value and the ETag that carried the key come back masked.
    assert.equal(result.clients.one.fetches[0].values.fireemu_echo.value, "API_KEY");
    assert.ok(result.clients.one.wire.some((e) => e.responseHeaders?.etag?.endsWith("-API_KEY")));
    // The key as a parameter name reached the listener's update keys, masked.
    assert.ok(
      result.clients.one.updates.some((u) => (u.keys ?? []).includes("API_KEY")),
      JSON.stringify(result.clients.one.updates),
    );
    const journal = readFileSync(join(result.out, "journal.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    for (const row of journal.filter(
      (r) => r.case.startsWith("k-") && r.phase === "response-persisted",
    ))
      assert.deepEqual(
        [row.file, row.secret, "sha256" in row, "etag" in row, "contentType" in row],
        [null, true, false, false, false],
        row.case,
      );
  },
);

test("v1.1 item 1: Playwright diagnostics must be off", async () => {
  for (const env of [
    { DEBUG: "pw:protocol" },
    { DEBUG: "*" },
    { PWDEBUG: "1" },
    { DEBUG_FILE: "/x" },
  ]) {
    let opened = null;
    try {
      opened = await openBrowser({ port: 47822, cap: 1, env });
    } catch (error) {
      assert.match(error.message, /diagnostics/, JSON.stringify(env));
      continue;
    } finally {
      await opened?.close();
    }
    assert.fail(`diagnostics ${JSON.stringify(env)} were accepted`);
  }
});

test(
  "v1.1 item 2: phase A fails closed before any write",
  { timeout: 120_000, skip },
  async (t) => {
    for (const [port, admin, reason] of [
      [47823, { listStatus: 403 }, /key list not complete \(403\)/],
      [47824, { listStatus: 429 }, /key list not complete \(429\)/],
      [47825, { listNextPage: true }, /key list not complete \(200\)/],
      [47826, { appsNextPage: true }, /web apps list not complete/],
    ]) {
      const result = await productionPass(t, port, { admin });
      assert.match(result.stopped, reason);
      const journal = readFileSync(join(result.out, "journal.jsonl"), "utf8");
      assert.ok(
        !journal.includes('"method":"POST"') && !journal.includes('"method":"PUT"'),
        JSON.stringify(admin),
      );
      assert.deepEqual(result.open, []);
    }
  },
);

test(
  "v1.1 item 3: a create poll that fails is retried in G and the key is deleted and proved",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47827, { admin: { createPollFailures: 1 } });
    assert.match(result.stopped, /k-create-poll-0: unknown answer/);
    assert.equal(result.key.deleted, true);
    assert.ok(
      !result.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
    assert.equal(result.complete, false);
  },
);

test(
  "v1.1 item 3: an unknown create stays open and the sandbox is not at baseline",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47828, { admin: { createLost: true } });
    assert.ok(
      result.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
    assert.equal(result.sandboxAtBaseline, false);
    assert.equal(result.complete, false);
  },
);

test(
  "v1.1 item 5: a created key of another project is not granted and stays open",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47829, { admin: { keyProject: "999999999999" } });
    assert.match(result.stopped, /unexpected key name/);
    assert.ok(
      result.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
    assert.equal(result.complete, false);
  },
);

test(
  "v1.1 item 6: a 429 on the page's side stops the forward program and the cleanup still runs",
  { timeout: 120_000, skip },
  async (t) => {
    const result = await productionPass(t, 47830, { client: { fetchStatus: 429 } });
    assert.match(result.stopped, /throttled|429/);
    assert.equal(
      result.steps.some((s) => s.name === "r1-changed"),
      false,
    );
    assert.equal(result.baseline.after.empty, true);
    assert.equal(result.key.deleted, true);
    assert.equal(result.clients.one.deletion.deleted, true);
  },
);

test(
  "v1.1 item 4: the installations' deletions have a reserve after the cap, and a hanging call times out",
  { timeout: 120_000, skip },
  async (t) => {
    const capped = await productionPass(t, 47831, { cap: 3 });
    assert.ok(capped.cleanupRequests >= 1, JSON.stringify(capped.refusals));
    const hung = await productionPass(t, 47832, {
      client: { deleteHangs: true },
      callTimeoutMs: 3000,
    });
    assert.ok(
      hung.open.some((item) => /g-one: page call deleteInstallation timed out/.test(item)),
      JSON.stringify(hung.open),
    );
    assert.equal(hung.complete, false);
  },
);

test(
  "v1.1 survivors: a malformed operation name is refused before any read",
  { timeout: 120_000, skip },
  async (t) => {
    const op = await productionPass(t, 47834, {
      admin: { operationName: "projects/x/operations/1" },
    });
    assert.match(op.stopped, /unexpected operation name/);
    assert.ok(
      op.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
  },
);

// ---- RC-CLOSURE-B v1.2 (ruling 18) ----

/** The journal's cases of one pass, in order. */
const casesOf = (out) =>
  readFileSync(join(out, "journal.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.phase === "before-send")
    .map((r) => r.case);
const FORWARD = ["t1-publish", "r1-changed", "r2-metadata", "r3-same", "r4-rollback", "r5-changed"];

test(
  "ruling 18 item 1: a browser 403 or 429 (fetch, realtime open, reconnect) or a hook stop sends no later publication",
  { timeout: 300_000, skip },
  async (t) => {
    for (const [port, options, reason, last] of [
      // The realtime stream answers 429 or 403 when it opens: r1 is never sent. Which page-side
      // signal the gate meets first (the hook's stop or the listener's error) depends on timing.
      [
        47840,
        { client: { streamStatus: 429 } },
        /realtime.*answered 429|listener reported/,
        "t1-publish",
      ],
      [
        47841,
        { client: { streamStatus: 403 } },
        /realtime.*answered 403|listener reported/,
        "t1-publish",
      ],
      // Every stream after r4 answers 429 (the SDK's own after r4's update and the reconnect's):
      // r5 is never sent.
      [
        47842,
        {
          client: (out) => ({
            streamStatusNow: () => (casesOf(out).includes("r4-rollback") ? 429 : 200),
          }),
        },
        /realtime.*answered 429/,
        "r4-rollback",
      ],
      // A fetch answered 403: nothing after t1.
      [47843, { client: { fetchStatus: 403 } }, /403|failure/, "t1-publish"],
    ]) {
      const result = await productionPass(t, port, options);
      assert.match(result.stopped ?? "", reason, String(port));
      const forward = casesOf(result.out).filter((c) => FORWARD.includes(c));
      assert.equal(forward.at(-1), last, `${port}: ${forward}`);
      // G still restores and cleans up.
      assert.equal(result.baseline.after.empty, true);
      assert.equal(result.key.deleted, true);
    }
    // A hook stop that lands after an early update: the next publication is not sent.
    let browser = null;
    let fetches = 0;
    const stopped = await productionPass(t, 47844, {
      hold: (b) => {
        browser = b;
      },
      client: {
        onFetch: () => {
          fetches += 1;
          // The fifth fetch is the listener's, after r1's update.
          if (fetches === 5) browser.stop("test: stopped after an update");
        },
      },
    });
    assert.match(stopped.stopped ?? "", /test: stopped after an update/);
    const forward = casesOf(stopped.out).filter((c) => FORWARD.includes(c));
    assert.equal(forward.at(-1), "r1-changed", String(forward));
  },
);

test(
  "ruling 18 item 5: an installation whose create went out is settled only by a DELETE seen on the wire",
  { timeout: 120_000, skip },
  async (t) => {
    // The create took effect but its answer was lost: the SDK deletes its local entry without a
    // request and reports success; the pass keeps the installation open.
    const result = await productionPass(t, 47845, { client: { createFails: true } });
    assert.equal(result.complete, false);
    assert.ok(
      result.open.some((item) =>
        /^g-one: installation deletion not proved on the wire \(0 of [1-9]/.test(item),
      ),
      JSON.stringify(result.open),
    );
    // A normal pass proves both deletions.
    const normal = await productionPass(t, 47846);
    assert.deepEqual(
      normal.installations.map((p) => [p.name, p.proved === p.dispatched, p.dispatched > 0]),
      [
        ["one", true, true],
        ["two", true, true],
      ],
    );
  },
);

test(
  "ruling 18 item 6: phase A judges every read by its shape and the provider's project number",
  { timeout: 300_000, skip },
  async (t) => {
    for (const [port, options, reason] of [
      [47847, { admin: { servicesNextPage: true } }, /services not complete/],
      [47848, { admin: { listError: true } }, /key list not complete \(200\)/],
      [47849, { number: "123456789013" }, /not ENABLED under the configured project number/],
    ]) {
      const result = await productionPass(t, port, options);
      assert.match(result.stopped, reason);
      assert.ok(!casesOf(result.out).includes("k-create"), JSON.stringify(options));
      assert.deepEqual(result.open, []);
    }
    // A deletion read back with an empty deleteTime is not a deletion.
    const empty = await productionPass(t, 47850, { admin: { deleteTime: "" } });
    assert.equal(empty.key.deleted, false);
    assert.ok(
      empty.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
  },
);

test(
  "ruling 18 items 3 and 9: main's production path offline: complete files, no key or installation secret in any of them",
  { timeout: 180_000, skip },
  async (t) => {
    const { main, PROJECT: SANDBOX } = await import("./record.mjs");
    const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-main-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const fake = world({ project: SANDBOX, echoKey: true });
    const printed = [];
    t.mock.method(console, "log", (line) => printed.push(line));
    const code = await main(
      ["--send-production", "--out", join(dir, "send-web-1")],
      { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
      {
        token: () => "t",
        fetchImpl: productionAdmin(fake),
        openBrowser: (options) => openBrowser({ ...options, fake: fake.client }),
        timing: TIMING,
        port: 47851,
      },
    );
    const out = join(dir, "send-web-1");
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    assert.equal(code, 0, JSON.stringify([result.stopped, result.open]));
    assert.equal(result.complete, true);
    const run = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
    assert.equal(run.runId, result.runId);
    assert.equal(run.pid, process.pid);
    for (const name of ["one", "two"]) {
      const wire = JSON.parse(readFileSync(join(out, `wire-${name}.json`), "utf8"));
      assert.ok(wire.length > 0);
      assert.equal(result.clients[name].wire, undefined);
    }
    const { readdirSync } = await import("node:fs");
    const secrets = [
      KEY,
      ...fake.fids,
      "fake-refresh-1",
      "fake-refresh-2",
      "fake-auth-token-1",
      "fake-auth-token-2",
    ];
    for (const file of readdirSync(out))
      for (const secret of secrets)
        assert.ok(!readFileSync(join(out, file), "utf8").includes(secret), `${file}: ${secret}`);
    for (const secret of secrets) assert.ok(!printed.join("\n").includes(secret));
    assert.ok(!result.open.some((item) => item.startsWith("leak:")));
  },
);

test(
  "ruling 18 item 9: the page's own requests never follow a redirect (loopback server, no hook on it)",
  { timeout: 60_000, skip },
  async (t) => {
    const { createServer } = await import("node:http");
    const { pinnedBundles } = await import("./driver.mjs");
    const { GSTATIC } = await import("./driver.mjs");
    const bundles = pinnedBundles();
    const hits = [];
    const server = createServer((req, res) => {
      hits.push(req.url);
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<!doctype html><script type="module" src="/page.mjs"></script>');
      } else if (req.url === "/page.mjs") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(readFileSync(new URL("./page.mjs", import.meta.url)));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "/hop" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hop");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: "block" });
    // Only the bundles are answered by a hook; nothing else leaves the loopback, and the loopback
    // itself is not intercepted (as production's route.continue, whose hops the hook never sees).
    await context.route(
      (url) => !url.href.startsWith(origin),
      (route) =>
        route.request().url().startsWith(GSTATIC)
          ? route.fulfill({
              status: 200,
              contentType: "text/javascript",
              body: bundles[route.request().url().slice(GSTATIC.length)],
            })
          : route.abort(),
    );
    const page = await context.newPage();
    await page.addInitScript(
      (input) => {
        window.__RC_INPUT = input;
      },
      {
        config: { apiKey: "K", projectId: "p", appId: "1:1:web:ab", messagingSenderId: "1" },
        sdk: GSTATIC,
      },
    );
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.rcReady === true, null, { timeout: 30_000 });
    const outcome = await page.evaluate(() =>
      fetch("/redirect").then(
        () => "followed",
        (error) => error.name,
      ),
    );
    assert.equal(outcome, "TypeError");
    assert.ok(hits.includes("/redirect"), String(hits));
    assert.equal(hits.includes("/hop"), false, String(hits));
  },
);

test(
  "ruling 18 near misses: the app's project number, a read-back of another name, a poll of another operation, an installation DELETE refused",
  { timeout: 300_000, skip },
  async (t) => {
    const app = await productionPass(t, 47852, { admin: { appNumber: "123456789013" } });
    assert.match(app.stopped, /configured project number is not the provider's/);
    assert.ok(!casesOf(app.out).includes("k-create"));
    const back = await productionPass(t, 47853, {
      admin: { readbackName: `projects/${NUMBER}/locations/global/keys/other` },
    });
    assert.equal(back.key.deleted, false);
    const poll = await productionPass(t, 47854, { admin: { pollName: "operations/other" } });
    assert.match(poll.stopped, /k-create: operation read 200/);
    const refused = await productionPass(t, 47855, { client: { deleteFails: true } });
    assert.ok(
      refused.open.some((item) =>
        item.startsWith("g-one: installation deletion not proved on the wire (0 of"),
      ),
      JSON.stringify(refused.open),
    );
  },
);

test(
  "ruling 18 item 3: a key value in a journaled answer is found and masked by the leak check",
  { timeout: 180_000, skip },
  async (t) => {
    const { main, PROJECT: SANDBOX } = await import("./record.mjs");
    const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-main-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const fake = world({ project: SANDBOX });
    t.mock.method(console, "log", () => {});
    const code = await main(
      ["--send-production", "--out", join(dir, "send-web-1")],
      { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
      {
        token: () => "t",
        fetchImpl: productionAdmin(fake, { leakKeyInTemplate: true }),
        openBrowser: (options) => openBrowser({ ...options, fake: fake.client }),
        timing: TIMING,
        port: 47856,
      },
    );
    const out = join(dir, "send-web-1");
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    // Ruling 19 item 2: the transport masks the key before the body's first write; the final scan
    // finds nothing left, and result.json's complete is written after it.
    assert.equal(code, 0, JSON.stringify([result.stopped, result.open]));
    assert.equal(result.leakCheck, "done");
    assert.ok(!result.open.some((item) => item.startsWith("leak:")));
    const { readdirSync } = await import("node:fs");
    for (const file of readdirSync(out))
      assert.ok(!readFileSync(join(out, file), "utf8").includes(KEY), file);
    const redacted = readFileSync(join(out, "journal.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.redacted === true);
    assert.ok(
      redacted.some((r) => r.case === "g-client"),
      JSON.stringify(redacted),
    );
    const body = readdirSync(out).find((f) => f.endsWith("-g-client.body"));
    assert.ok(readFileSync(join(out, body), "utf8").includes("leak API_KEY"));
  },
);

test(
  "ruling 18 near misses: a listener error under a 200, a stream that fails without a status, a fetch the SDK cannot read, a fourth service",
  { timeout: 300_000, skip },
  async (t) => {
    for (const [port, options, reason, last] of [
      [
        47857,
        { client: { streamAfterPublish: "disabled" } },
        /the listener reported/,
        "r1-changed",
      ],
      [
        47858,
        { client: { streamAfterPublish: "redirect" } },
        /request failed \(TypeError\)/,
        "r1-changed",
      ],
      [47859, { client: { fetchGarbage: true } }, /f-one: failure/, "t1-publish"],
    ]) {
      const result = await productionPass(t, port, options);
      assert.match(result.stopped ?? "", reason, String(port));
      const forward = casesOf(result.out).filter((c) => FORWARD.includes(c));
      assert.equal(forward.at(-1), last, `${port}: ${forward}`);
    }
    const extra = await productionPass(t, 47860, { admin: { servicesExtra: true } });
    assert.match(extra.stopped, /not ENABLED under the configured project number/);
  },
);

test(
  "ruling 18 item 3: the leak check knows the key even when no page was opened",
  { timeout: 120_000, skip },
  async (t) => {
    const { main, PROJECT: SANDBOX } = await import("./record.mjs");
    const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-main-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const fake = world({ project: SANDBOX, putStatus: 400 });
    t.mock.method(console, "log", () => {});
    await main(
      ["--send-production", "--out", join(dir, "send-web-1")],
      { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
      {
        token: () => "t",
        fetchImpl: productionAdmin(fake, { leakKeyInTemplate: true }),
        openBrowser: (options) => openBrowser({ ...options, fake: fake.client }),
        timing: TIMING,
        port: 47861,
      },
    );
    const out = join(dir, "send-web-1");
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    assert.match(result.stopped, /t1-publish: 400/);
    assert.equal(result.leakCheck, "done");
    const { readdirSync } = await import("node:fs");
    for (const file of readdirSync(out))
      assert.ok(!readFileSync(join(out, file), "utf8").includes(KEY), file);
  },
);

// ---- RC-CLOSURE-B v1.3 (ruling 19) ----

/** The journal's rows of one pass. */
const rowsOf = (out) =>
  readFileSync(join(out, "journal.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test(
  "ruling 19 item 1: the hook stops at the answer: one fetch call's 429 lets no retry out; a 429 inside a window stops before the window ends",
  { timeout: 300_000, skip },
  async (t) => {
    // The SDK retries a 429 inside the same fetch call; the hook refuses the retry.
    const fetched = await productionPass(t, 47862, { client: { fetchStatus: 429 } });
    assert.match(fetched.stopped ?? "", /firebaseremoteconfig\.googleapis\.com answered 429/);
    const wire = fetched.clients.one?.wire ?? [];
    const sent = wire.filter((e) => e.path.endsWith(":fetch") && e.status !== null);
    assert.equal(sent.length, 1, JSON.stringify(wire.map((e) => [e.path, e.status, e.error])));
    // Counted where the request is answered (ruling 20): one dispatch; the SDK's retry was made
    // and refused after the stop.
    assert.equal(fetched.fake.fetches(), 1);
    assert.ok(
      fetched.refusals.some(
        (r) => r.host === "firebaseremoteconfig.googleapis.com" && r.reason === "after stop",
      ),
      JSON.stringify(fetched.refusals),
    );
    assert.ok(!casesOf(fetched.out).includes("r1-changed"));
    // A 429 on the stream inside r1's 30 s window: the stop comes long before the window's end.
    const windowed = await productionPass(t, 47863, {
      client: { streamAfterPublish: "429" },
      timing: { ...TIMING, updateWindowMs: 30_000 },
    });
    assert.match(windowed.stopped ?? "", /answered 429/);
    const rows = rowsOf(windowed.out).filter((r) => r.phase === "before-send");
    const at = (c) => Date.parse(rows.find((r) => r.case === c).at);
    assert.ok(
      at("g-client") - at("r1-changed") < 15_000,
      String(at("g-client") - at("r1-changed")),
    );
    assert.ok(!casesOf(windowed.out).includes("r2-metadata"));
  },
);

test(
  "ruling 19 item 5: a definite 4xx create and a delete operation with the deleted key settle without the owner",
  { timeout: 300_000, skip },
  async (t) => {
    const google = { error: { code: 400, status: "INVALID_ARGUMENT", message: "x" } };
    const refused = await productionPass(t, 47864, {
      admin: { createRefusal: { status: 400, body: google } },
    });
    assert.match(refused.stopped, /k-create: refused 400/);
    assert.deepEqual(refused.open, []);
    assert.equal(refused.key.createRefused, 400);
    assert.equal(refused.sandboxAtBaseline, true);
    // A 4xx without Google's error body is not a definite refusal: the key's item stays open.
    const bare = await productionPass(t, 47865, {
      admin: { createRefusal: { status: 400, body: {} } },
    });
    assert.ok(
      bare.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
    const other = await productionPass(t, 47866, {
      admin: { createRefusal: { status: 400, body: { error: { ...google.error, code: 403 } } } },
    });
    assert.ok(other.open.length > 0);
    // The done delete operation proves the deletion even when the read-back answers 404.
    const byOperation = await productionPass(t, 47867, {
      admin: { deleteOpDeleteTime: "2026-11-26T00:00:00.5Z", readbackStatus: 404 },
    });
    assert.equal(byOperation.key.deleted, true);
    assert.deepEqual(byOperation.key.deletedBy, ["operation"]);
    assert.equal(byOperation.key.readback, 404);
    assert.deepEqual(byOperation.open, []);
    // An operation response with an impossible date proves nothing; a 404 read-back neither.
    const impossible = await productionPass(t, 47868, {
      admin: { deleteOpDeleteTime: "2026-02-30T00:00:00Z", readbackStatus: 404 },
    });
    assert.equal(impossible.key.deleted, false);
    assert.ok(
      impossible.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
  },
);

test(
  "ruling 19 items 1 and 2: an admin-side stop stops the hook; result.json stays not complete until the leak check passed",
  { timeout: 180_000, skip },
  async (t) => {
    let browser = null;
    const stopped = await productionPass(t, 47869, {
      admin: { listStatus: 403 },
      hold: (b) => {
        browser = b;
      },
    });
    assert.match(stopped.stopped, /key list not complete \(403\)/);
    // The admin 403 stopped the hook when its headers arrived (ruling 20).
    assert.equal(browser.stopped(), "a-keys answered 403");
    // A leak check that cannot finish leaves result.json not complete and pending.
    const { main, PROJECT: SANDBOX } = await import("./record.mjs");
    const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-main-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const fake = world({ project: SANDBOX });
    t.mock.method(console, "log", () => {});
    await assert.rejects(
      main(
        ["--send-production", "--out", join(dir, "send-web-1")],
        { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
        {
          token: () => "t",
          fetchImpl: productionAdmin(fake),
          openBrowser: async (options) => {
            const opened = await openBrowser({ ...options, fake: fake.client });
            return Object.assign(opened, {
              mask: async () => {
                throw new Error("test: the leak check cannot finish");
              },
            });
          },
          timing: TIMING,
          port: 47870,
        },
      ),
      /the leak check cannot finish/,
    );
    const result = JSON.parse(readFileSync(join(dir, "send-web-1", "result.json"), "utf8"));
    assert.deepEqual([result.complete, result.leakCheck], [false, "pending"]);
  },
);

test(
  "ruling 20: a read-back showing the key live outweighs the delete operation; a 408 create is not a refusal",
  { timeout: 180_000, skip },
  async (t) => {
    const live = await productionPass(t, 47871, {
      admin: { keyStaysLive: true, deleteOpDeleteTime: "2026-11-26T00:00:00Z" },
    });
    assert.equal(live.key.deleted, false);
    assert.equal(live.key.readbackLive, true);
    assert.ok(
      live.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
    assert.ok(live.open.some((item) => item.startsWith("k-readback: the key reads live")));
    assert.equal(live.complete, false);
    const timeout = await productionPass(t, 47872, {
      admin: {
        createRefusal: {
          status: 408,
          body: { error: { code: 408, status: "DEADLINE_EXCEEDED", message: "x" } },
        },
      },
    });
    assert.equal(timeout.key.createRefused, undefined);
    assert.ok(
      timeout.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
  },
);

for (const point of ["gate", "credentials"]) {
  test(`ruling 20: a stop during ${point} is seen before dispatch`, async (t) => {
    const out = mkdtempSync(join(tmpdir(), "rc-closure-b-fake-"));
    t.after(() => rmSync(out, { recursive: true, force: true }));
    const fake = world();
    let tokenReads = 0;
    let stopped = false;
    const transport = new Transport({
      out,
      allow: () => true,
      token: async () => {
        tokenReads += 1;
        // The second token belongs to the first template write, after the baseline read.
        if (point === "credentials" && tokenReads === 2) stopped = true;
        return "t";
      },
      maxRequests: 60,
      timeoutMs: 5000,
      fetchImpl: fake.admin,
    });
    // The hook's state: running for the gate's first read, stopped from the next one on.
    let reads = 0;
    const browser = {
      stopped: () =>
        stopped || (point === "gate" && ++reads > 1) ? `test: stopped during ${point}` : null,
      stop: () => {},
      client: async () => {
        throw new Error("no page");
      },
      installations: async () => [],
      allowedRequests: () => 0,
      cleanupRequests: () => 0,
      refusals: [],
    };
    const result = await observe({
      transport,
      browser,
      urls: { client: ADMIN },
      project: PROJECT,
      number: NUMBER,
      appId: `1:${NUMBER}:web:0000000000000000000000`,
      fakeKey: KEY,
      runId: "261126000000abc",
      timing: TIMING,
      production: false,
    });
    assert.match(result.stopped, new RegExp(`test: stopped during ${point}`));
    assert.ok(!casesOf(out).includes("t1-publish"), String(casesOf(out)));
  });
}

for (const phase of ["known", "learned during the scan", "masking interrupted"]) {
  test(`a secret in a returned template version stays out of the saved result and summary (${phase})`, async (t) => {
    const { main, closureRefusal, PROJECT: SANDBOX } = await import("./record.mjs");
    const { mkdirSync, realpathSync, writeFileSync } = await import("node:fs");
    const out = mkdtempSync(join(tmpdir(), "rc-result-mask-"));
    t.after(() => rmSync(out, { recursive: true, force: true }));
    const fake = productionAdmin(world({ project: SANDBOX }));
    const messages = [];
    t.mock.method(console, "log", (line) => messages.push(line));
    const resultDir = join(out, "send-web-1");
    const secret = phase === "learned during the scan" ? "synthetic-late-token" : KEY;
    let learned = false;
    const completed = main(
      ["--send-production", "--out", resultDir],
      { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
      {
        token: () => "t",
        fetchImpl: async (url, init) => {
          const response = await fake(url, init);
          if (init.method !== "PUT" || response.status !== 200) return response;
          const document = await response.json();
          document.version.versionNumber = secret;
          return Response.json(document, { headers: response.headers });
        },
        openBrowser: async () => ({
          client: async () => {
            throw new Error("test: no page");
          },
          stopped: () => null,
          stop: () => {},
          mask: async (value) => {
            if (phase === "masking interrupted") throw new Error("test: masking interrupted");
            if (phase !== "learned during the scan") return value;
            if (learned) return value.replaceAll(secret, "TOKEN");
            learned = value.includes('"leakCheck"') && value.includes(secret);
            return value;
          },
          installations: async () => [],
          allowedRequests: () => 0,
          refusals: [],
          close: async () => {},
        }),
        timing: TIMING,
      },
    );
    if (phase === "masking interrupted")
      await assert.rejects(completed, /test: masking interrupted/);
    else assert.equal(await completed, 1);
    const text = readFileSync(join(resultDir, "result.json"), "utf8");
    assert.ok(!text.includes(secret));
    assert.ok(!messages.join("").includes(secret));
    const result = JSON.parse(text);

    if (phase !== "masking interrupted") {
      assert.equal(result.leakCheck, "done");
      assert.equal(
        result.steps.find(({ name }) => name === "t1").version,
        phase === "known" ? "API_KEY" : "TOKEN",
      );
      assert.ok(result.open.some((line) => line.startsWith("leak: result.json")));
      return;
    }

    assert.equal(result.leakCheck, "pending");
    assert.equal(result.complete, false);
    assert.deepEqual(result.open, ["result snapshot unavailable"]);
    const runId = result.runId;
    const a2 = `${resultDir}-a2-1`;
    const a2Of = realpathSync(resultDir);
    mkdirSync(a2);
    writeFileSync(join(a2, "run.json"), JSON.stringify({ runId, a2Of }));
    writeFileSync(
      join(a2, "a2.json"),
      JSON.stringify({
        runId,
        a2Of,
        atBaseline: true,
        clientEmpty: true,
        keyListComplete: true,
        errors: [],
      }),
    );
    const owner = join(out, "owner.md");
    assert.match(closureRefusal(resultDir, owner), /no acceptance or recovery record/);
    writeFileSync(
      `${resultDir}-acceptance.json`,
      JSON.stringify({
        runId,
        kind: "recovery",
        ledgerLine: 1,
        open: ["result snapshot unavailable", "leak-check: not done"],
      }),
    );
    writeFileSync(
      owner,
      `- 2026-11-26 | RC-CLOSURE-B decision | packetId=RC-CLOSURE-B-V1-3 runId=${runId} decision=recovery | owner | test
`,
    );
    assert.equal(closureRefusal(resultDir, owner), null);
  });
}
