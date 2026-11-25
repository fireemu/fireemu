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
  fetchRedirect = false,
} = {}) {
  const history = new Map([[27, {}]]);
  let version = 27;
  const pending = [];
  const fids = [];
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
    if (url.pathname.endsWith(":fetch") && fetchStatus !== 200)
      return {
        status: fetchStatus,
        headers: { "content-type": "application/json" },
        body: '{"error":{"code":429}}',
      };
    if (url.pathname.endsWith(":fetch")) {
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
    if (url.pathname.endsWith(":fetch") && fetchRedirect)
      return { status: 302, headers: { location: "https://elsewhere.example/v1/fetch" }, body: "" };
    if (url.pathname.endsWith(":streamFetchInvalidations") && streamStatus !== 200)
      return { status: streamStatus, headers: { "content-type": "application/json" }, body: "{}" };
    if (url.pathname.endsWith(":streamFetchInvalidations")) {
      const next = await new Promise((resolve) => pending.push(resolve));
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: `[{\n  "latestTemplateVersionNumber": "${next}"\n}`,
      };
    }
    return { status: 404, headers: {}, body: "" };
  };
  return { admin, client, fids, version: () => version, history };
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
        services: url.searchParams
          .getAll("names")
          .map((n) => ({ config: { name: n.split("/").at(-1) }, state: "ENABLED" })),
      });
    if (url.host === "firebase.googleapis.com")
      return json(200, {
        apps: [{ displayName: "listen-l1", appId: `1:${NUMBER}:web:0000000000000000000000` }],
        ...(appsNextPage ? { nextPageToken: "more" } : {}),
      });
    if (url.host === "apikeys.googleapis.com") {
      const path = url.pathname.slice("/v2/".length);
      if (init.method === "POST") {
        const name = `projects/${keyProject}/locations/global/keys/k${keys.length}`;
        keys.push({ name, displayName: JSON.parse(init.body).displayName });
        if (createLost) return keyed(500, {});
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
          name: path,
          done: true,
          response: { name: keys.at(-1).name, keyString: KEY, displayName: "rc-closure-b-sdk" },
        });
      }
      if (path.startsWith("operations/delete-"))
        return keyed(200, {
          name: path,
          done: true,
          response: { name: keys.at(-1).name, keyString: KEY },
        });
      if (path.endsWith("/keyString")) return keyed(200, { keyString: KEY });
      if (init.method === "DELETE") {
        if (!keyStaysLive) keys.find((k) => k.name === path).deleteTime = "2026-11-25T00:00:00Z";
        return keyLost
          ? keyed(500, {})
          : keyed(200, { name: `operations/delete-${keys.length}`, done: false });
      }
      if (url.search === "" && path.startsWith("projects/") && path.includes("/keys/"))
        return keyed(
          200,
          keys.find((k) => k.name === path),
        );
      if (listStatus !== 200) return json(listStatus, { error: { code: listStatus } });
      return json(200, {
        keys: keys.filter((k) => url.search.includes("showDeleted") || !k.deleteTime),
        ...(listNextPage ? { nextPageToken: "more" } : {}),
      });
    }
    return fake.admin(url, init);
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
    assert.equal(valueRow.file, null);
    assert.equal(valueRow.sha256, null);
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
async function productionPass(t, port, { admin = {}, client = {}, cap = 80, callTimeoutMs } = {}) {
  const out = mkdtempSync(join(tmpdir(), "rc-closure-b-fake-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const fake = world(client);
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
  const result = await observe({
    transport,
    browser,
    urls: { ...adminUrls(SANDBOX), client: ADMIN },
    project: PROJECT,
    number: NUMBER,
    runId: "261125000000abg",
    timing: TIMING,
    production: true,
    grant: (kind, value) => {
      if (kind === "operation") grants.operations.add(value);
      if (kind === "key") grants.key = value;
    },
  });
  return Object.assign(result, { out });
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
      "k-readback: no deleteTime (A2 lists keys)",
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
      assert.deepEqual([row.file, row.sha256, row.etag], [null, null, null], row.case);
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
  "v1.1 survivors: a realtime 429, a malformed operation name, a redirect",
  { timeout: 180_000, skip },
  async (t) => {
    // A 429 the SDK does not report as a fetch status (the realtime stream's) still stops.
    const stream = await productionPass(t, 47833, { client: { streamStatus: 429 } });
    assert.match(stream.stopped ?? "", /page one: 429|did not open/);
    assert.equal(
      stream.steps.some((s) => s.name === "r2-metadata"),
      false,
    );
    // An operation name outside its form is refused by the recorder itself, before any read.
    const op = await productionPass(t, 47834, {
      admin: { operationName: "projects/x/operations/1" },
    });
    assert.match(op.stopped, /unexpected operation name/);
    assert.ok(
      op.open.includes(
        "k-create: the key may exist until its deletion is read back (A2 lists keys)",
      ),
    );
    // A redirect is an error in the page: its target never reaches the hook.
    const moved = await productionPass(t, 47835, { client: { fetchRedirect: true } });
    assert.equal(
      moved.refusals.some((r) => r.host === "elsewhere.example"),
      false,
      JSON.stringify(moved.refusals),
    );
  },
);
