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
  for (const host of HOSTS) assert.equal(classify(`https://${host}/v1/x`, origin), "allowed");
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
