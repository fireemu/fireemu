import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BUNDLES, GSTATIC, HOSTS, classify, originOf } from "./driver.mjs";
import { API_TARGETS, KEY_ID, SIGNALS, template } from "./program.mjs";
import { PROJECT, adminUrls, main, productionAllow } from "./record.mjs";

const NUMBER = "123456789012";

test("the admin allow list: exactly the packet's forms, operations and the key only once granted", () => {
  const grants = { operations: new Set(), key: null };
  const allow = productionAllow(PROJECT, grants);
  const ok = (href, method = "GET") => allow(new URL(href), method);
  const u = adminUrls(PROJECT);
  for (const [href, method] of [
    [u.client, "GET"],
    [u.client, "PUT"],
    [`${u.client}:rollback`, "POST"],
    [u.services, "GET"],
    [u.webApps, "GET"],
    [u.keysList, "GET"],
    [u.keysListDeleted, "GET"],
    [u.keysCreate, "POST"],
  ])
    assert.ok(ok(href, method), `${method} ${href}`);
  const op = "operations/akmf.p7-123";
  const key = `projects/${NUMBER}/locations/global/keys/abc-123`;
  const keysApi = "https://apikeys.googleapis.com/v2/";
  // Before the pass learns them, no operation and no key is readable, and nothing is deletable.
  assert.equal(ok(`${keysApi}${op}`), false);
  assert.equal(ok(`${keysApi}${key}`), false);
  assert.equal(ok(`${keysApi}${key}/keyString`), false);
  assert.equal(ok(`${keysApi}${key}`, "DELETE"), false);
  grants.operations.add(op);
  grants.key = key;
  assert.ok(ok(`${keysApi}${op}`));
  assert.ok(ok(`${keysApi}${key}`));
  assert.ok(ok(`${keysApi}${key}/keyString`));
  assert.ok(ok(`${keysApi}${key}`, "DELETE"));
  for (const [href, method] of [
    [`${keysApi}${op}`, "DELETE"],
    [`${keysApi}${key}/keyString`, "DELETE"],
    [`${keysApi}${key}x`, "GET"],
    [`${keysApi}projects/${NUMBER}/locations/global/keys/other`, "DELETE"],
    [`${keysApi}${key}?x=1`, "GET"],
    [`${u.keysCreate}?keyId=x`, "POST"],
    [u.keysCreate, "DELETE"],
    [u.client, "DELETE"],
    [`${u.client}?versionNumber=1`, "GET"],
    [u.client.replace(PROJECT, "other-project"), "GET"],
    [u.client.replace("https:", "http:"), "GET"],
    [`https://example.com/v2/${key}`, "GET"],
    [`${u.services}&names=x`, "GET"],
    [`${u.webApps}/x`, "GET"],
  ])
    assert.equal(ok(href, method), false, `${method} ${href}`);
  assert.equal(allow(new URL(u.client), "GET", { signed: true }), false);
});

test("the page may load its own files, the three bundles and the three hosts, nothing else", () => {
  const origin = originOf(47853);
  assert.equal(classify(`${origin}/`, origin), "page");
  assert.equal(classify(`${origin}/lib/page.mjs`, origin), "page");
  assert.equal(classify(`${origin}/lib/other.mjs`, origin), "refused");
  for (const file of BUNDLES) assert.equal(classify(`${GSTATIC}${file}`, origin), "bundle");
  assert.equal(classify(`${GSTATIC}firebase-auth.js`, origin), "refused");
  for (const host of HOSTS) assert.equal(classify(`https://${host}/v1/x`, origin), "remote");
  for (const href of [
    "http://firebaseremoteconfig.googleapis.com/v1/x",
    "https://firebaseremoteconfig.googleapis.com:8443/v1/x",
    "https://u@firebaseinstallations.googleapis.com/v1/x",
    "https://firebase.googleapis.com/v1/x",
    "https://www.google-analytics.com/g/collect",
    "https://firebaselogging-pa.googleapis.com/v1/x",
  ])
    assert.equal(classify(href, origin), "refused", href);
  assert.deepEqual(HOSTS, API_TARGETS);
});

test("main never sends without the flag, with a credential file, or without the number", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-main-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "run");
  await assert.rejects(
    main(["--out", out], { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER }),
    /--send-production/,
  );
  await assert.rejects(
    main(["--send-production", "--out", out], {
      FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER,
      GOOGLE_APPLICATION_CREDENTIALS: "/x",
    }),
    /GOOGLE_APPLICATION_CREDENTIALS/,
  );
  await assert.rejects(
    main(["--send-production", "--out", out], {
      FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER,
      CLOUDSDK_CORE_PROJECT: "p",
    }),
    /CLOUDSDK/,
  );
  await assert.rejects(
    main(["--send-production", "--out", out], {}),
    /FIREEMU_SANDBOX_PROJECT_NUMBER/,
  );
  await assert.rejects(
    main(["--send-production", "--out", dir], { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER }),
    /must not exist/,
  );
  await assert.rejects(main(["--target", "local"], {}), /unknown argument/);
});

test("the corpus: two signal sets, the template's conditions and value types", () => {
  assert.deepEqual(Object.keys(SIGNALS), ["s1", "s2"]);
  const v1 = template("v1", "261125000000abc");
  assert.deepEqual(
    v1.conditions.map((c) => c.name),
    ["fireemu_premium", "fireemu_level", "fireemu_half"],
  );
  assert.deepEqual(
    Object.values(v1.parameters).map((p) => p.valueType ?? null),
    ["STRING", "NUMBER", "BOOLEAN", "JSON", null],
  );
  assert.equal(v1.version.description, "fireemu rc-closure-b 261125000000abc v1");
  assert.equal(KEY_ID, "rc-closure-b-sdk");
});

// ---- RC-CLOSURE-B v1.1 (ruling 16) ----

test("v1.1 item 4: the page's requests by method, host, path and query, bound to the context", async () => {
  const { requestPolicy } = await import("./driver.mjs");
  const own = { project: "p-web", key: "K1", fids: new Set() };
  const fid = "cAAAAAAAAAAAAAAAAAAAAA";
  const ask = (method, href, { headers = {}, postData } = {}) =>
    requestPolicy({ method, href, headers, postData }, own);
  const inst = "https://firebaseinstallations.googleapis.com/v1/projects/p-web/installations";
  const keyed = { headers: { "x-goog-api-key": "K1" } };
  // An installation's own requests only after its create named it.
  assert.equal(ask("POST", `${inst}/${fid}/authTokens:generate`, keyed), "path");
  assert.equal(ask("POST", inst, { ...keyed, postData: JSON.stringify({ fid }) }), "allowed");
  assert.equal(ask("POST", `${inst}/${fid}/authTokens:generate`, keyed), "allowed");
  assert.equal(ask("DELETE", `${inst}/${fid}`, keyed), "delete");
  for (const [method, href, options, reason] of [
    [
      "POST",
      inst,
      { headers: { "x-goog-api-key": "K2" }, postData: JSON.stringify({ fid }) },
      "key",
    ],
    ["POST", inst, { ...keyed, postData: JSON.stringify({ fid: "short" }) }, "installation id"],
    ["POST", `${inst}?x=1`, { ...keyed, postData: JSON.stringify({ fid }) }, "query"],
    ["GET", `${inst}/${fid}`, keyed, "method"],
    ["DELETE", `${inst}/cBBBBBBBBBBBBBBBBBBBBB`, keyed, "path"],
    ["DELETE", inst.replace("p-web", "other") + `/${fid}`, keyed, "path"],
    ["POST", `${inst}/${fid}/other`, keyed, "path"],
    [
      "POST",
      "https://firebaseremoteconfig.googleapis.com/v1/projects/other/namespaces/firebase:fetch?key=K1",
      {},
      "path",
    ],
    [
      "POST",
      "https://firebaseremoteconfig.googleapis.com/v1/projects/p-web/namespaces/firebase-server:fetch?key=K1",
      {},
      "path",
    ],
    [
      "POST",
      "https://firebaseremoteconfig.googleapis.com/v1/projects/p-web/namespaces/firebase:fetch?key=K2",
      {},
      "query",
    ],
    [
      "POST",
      "https://firebaseremoteconfig.googleapis.com/v1/projects/p-web/namespaces/firebase:fetch?key=K1&x=1",
      {},
      "query",
    ],
    [
      "GET",
      "https://firebaseremoteconfig.googleapis.com/v1/projects/p-web/namespaces/firebase:fetch?key=K1",
      {},
      "method",
    ],
    [
      "POST",
      "https://firebaseremoteconfig.googleapis.com/v1/projects/p-web/namespaces/firebase:streamFetchInvalidations?key=K1",
      {},
      "path",
    ],
  ])
    assert.equal(ask(method, href, options), reason, `${method} ${href}`);
  assert.equal(
    ask(
      "POST",
      "https://firebaseremoteconfig.googleapis.com/v1/projects/p-web/namespaces/firebase:fetch?key=K1",
    ),
    "allowed",
  );
  assert.equal(
    ask(
      "POST",
      "https://firebaseremoteconfigrealtime.googleapis.com/v1/projects/p-web/namespaces/firebase:streamFetchInvalidations?key=K1",
    ),
    "allowed",
  );
});

test("v1.1 item 5: a granted name is read only under the full API Keys prefix and in its form", () => {
  const grants = {
    operations: new Set(["operations/akmf.1"]),
    key: `projects/${NUMBER}/locations/global/keys/abc`,
  };
  const allow = productionAllow(PROJECT, grants);
  const ok = (href, method = "GET") => allow(new URL(href), method);
  assert.ok(ok("https://apikeys.googleapis.com/v2/operations/akmf.1"));
  assert.ok(ok(`https://apikeys.googleapis.com/v2/${grants.key}`, "DELETE"));
  for (const [href, method] of [
    ["https://apikeys.googleapis.com/v1/operations/akmf.1", "GET"],
    [`https://apikeys.googleapis.com/v1/${grants.key}`, "DELETE"],
    [`https://apikeys.googleapis.com/v2/${grants.key}#x`, "GET"],
  ])
    assert.equal(ok(href, method), false, href);
  // A grant not in its form is never usable.
  const bad = productionAllow(PROJECT, {
    operations: new Set(["projects/x"]),
    key: "projects/other/keys/x",
  });
  assert.equal(bad(new URL("https://apikeys.googleapis.com/v2/projects/x"), "GET"), false);
  assert.equal(
    bad(new URL("https://apikeys.googleapis.com/v2/projects/other/keys/x"), "DELETE"),
    false,
  );
});

test("v1.1 item 7: A2 has its own two read-only forms and fails closed on an incomplete key list", async () => {
  const { a2Allow, readBack } = await import("./record.mjs");
  const u = adminUrls(PROJECT);
  const allow = a2Allow(PROJECT);
  assert.ok(allow(new URL(u.client), "GET"));
  assert.ok(allow(new URL(u.keysListDeleted), "GET"));
  for (const [href, method] of [
    [u.client, "PUT"],
    [`${u.client}:rollback`, "POST"],
    [u.keysList, "GET"],
    [u.keysCreate, "POST"],
    [u.services, "GET"],
  ])
    assert.equal(allow(new URL(href), method), false, `${method} ${href}`);
  const transport = (keys) => ({
    count: 2,
    send: async (caseId) =>
      caseId === "a2-client"
        ? { status: 200, json: { version: { versionNumber: "46" } } }
        : { status: 200, json: keys },
  });
  assert.equal((await readBack(transport({ keys: [] }), u)).atBaseline, true);
  assert.equal(
    (await readBack(transport({ keys: [], nextPageToken: "more" }), u)).atBaseline,
    false,
  );
  assert.equal(
    (await readBack(transport({ keys: [{ displayName: KEY_ID }] }), u)).atBaseline,
    false,
  );
});

test("v1.1 item 7: A2 refuses to read within ten minutes of the pass's last activity", async (t) => {
  const { writeFileSync, utimesSync } = await import("node:fs");
  const { lastActivity } = await import("./record.mjs");
  const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-a2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pass = join(dir, "pass");
  (await import("node:fs")).mkdirSync(pass);
  writeFileSync(join(pass, "run.json"), '{"runId":"261125000000abc"}\n');
  writeFileSync(join(pass, "journal.jsonl"), "{}\n");
  await assert.rejects(
    main(["--send-production", "--a2-of", pass, "--out", join(dir, "a2")], {
      FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER,
    }),
    /10 minutes after the pass's last activity/,
  );
  const old = Date.now() / 1000 - 3600;
  utimesSync(join(pass, "run.json"), old, old);
  utimesSync(join(pass, "journal.jsonl"), old, old);
  assert.ok(Date.now() - lastActivity(pass) > 3_000_000);
});

test("v1.1 item 8: the SDK bundles are refused unless they are the pinned bytes and version", async (t) => {
  const { pinnedBundles, BUNDLE_SHA256 } = await import("./driver.mjs");
  assert.deepEqual(Object.keys(pinnedBundles()), Object.keys(BUNDLE_SHA256));
  assert.throws(() => pinnedBundles(undefined, "12.18.1"), /not the pinned 12\.18\.0/);
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-bundles-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of Object.keys(BUNDLE_SHA256)) writeFileSync(join(dir, file), "export {};\n");
  assert.throws(() => pinnedBundles(dir, "12.18.0"), /is not the pinned bundle/);
});

test("v1.1 item 7: an A2 invocation uses A2's own allow list", async () => {
  const { allowFor } = await import("./record.mjs");
  const u = adminUrls(PROJECT);
  const grants = { operations: new Set(), key: null };
  const a2 = allowFor({ "a2-of": "/x" }, grants);
  const pass = allowFor({}, grants);
  assert.equal(a2(new URL(u.client), "PUT"), false);
  assert.equal(a2(new URL(u.keysCreate), "POST"), false);
  assert.ok(a2(new URL(u.keysListDeleted), "GET"));
  assert.ok(pass(new URL(u.client), "PUT"));
});
