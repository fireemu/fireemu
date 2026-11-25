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

test("v1.1 item 4 and ruling 18 item 4: the page's requests, bound to the context's key, app and installations", async () => {
  const { requestPolicy } = await import("./driver.mjs");
  const own = { project: "p-web", key: "K1", appId: "1:1:web:ab", fids: new Set() };
  const fid = "cAAAAAAAAAAAAAAAAAAAAA";
  const other = "cBBBBBBBBBBBBBBBBBBBBB";
  const ask = (method, href, { headers = {}, postData } = {}) =>
    requestPolicy({ method, href, headers, postData }, own).verdict;
  const inst = "https://firebaseinstallations.googleapis.com/v1/projects/p-web/installations";
  const keyed = { headers: { "x-goog-api-key": "K1" } };
  const fetchUrl =
    "https://firebaseremoteconfig.googleapis.com/v1/projects/p-web/namespaces/firebase:fetch?key=K1";
  const streamUrl =
    "https://firebaseremoteconfigrealtime.googleapis.com/v1/projects/p-web/namespaces/firebase:streamFetchInvalidations?key=K1";
  const fetchBody = (f = fid, app = "1:1:web:ab") =>
    JSON.stringify({ app_instance_id: f, app_id: app, sdk_version: "x" });
  const streamBody = (f = fid, app = "1:1:web:ab", project = "p-web") =>
    JSON.stringify({ appInstanceId: f, appId: app, project, namespace: "firebase" });
  // A create is a create: its id is the context's only once the hook dispatched it (the driver
  // adds it), so before that nothing may name it.
  const created = requestPolicy(
    { method: "POST", href: inst, headers: keyed.headers, postData: JSON.stringify({ fid }) },
    own,
  );
  assert.deepEqual(created, { verdict: "create", fid });
  assert.equal(own.fids.has(fid), false);
  assert.equal(ask("POST", `${inst}/${fid}/authTokens:generate`, keyed), "path");
  assert.equal(ask("DELETE", `${inst}/${fid}`, keyed), "path");
  assert.equal(ask("POST", fetchUrl, { postData: fetchBody() }), "installation id");
  own.fids.add(fid);
  assert.equal(ask("POST", `${inst}/${fid}/authTokens:generate`, keyed), "allowed");
  assert.equal(ask("DELETE", `${inst}/${fid}`, keyed), "delete");
  assert.equal(ask("POST", fetchUrl, { postData: fetchBody() }), "allowed");
  assert.equal(ask("POST", fetchUrl, { ...keyed, postData: fetchBody() }), "allowed");
  assert.equal(ask("POST", streamUrl, { ...keyed, postData: streamBody() }), "allowed");
  for (const [method, href, options, reason] of [
    [
      "POST",
      inst,
      { headers: { "x-goog-api-key": "K2" }, postData: JSON.stringify({ fid }) },
      "key",
    ],
    ["POST", inst, { postData: JSON.stringify({ fid }) }, "key"],
    ["POST", inst, { ...keyed, postData: JSON.stringify({ fid: "short" }) }, "installation id"],
    ["POST", inst, { ...keyed, postData: "not json" }, "installation id"],
    ["POST", `${inst}?x=1`, { ...keyed, postData: JSON.stringify({ fid }) }, "query"],
    ["GET", `${inst}/${fid}`, keyed, "method"],
    ["DELETE", `${inst}/${other}`, keyed, "path"],
    ["DELETE", inst.replace("p-web", "other") + `/${fid}`, keyed, "path"],
    ["POST", `${inst}/${fid}/other`, keyed, "path"],
    // The fetch: another installation, another app, no body, another key, another project.
    ["POST", fetchUrl, { postData: fetchBody(other) }, "installation id"],
    ["POST", fetchUrl, { postData: fetchBody(fid, "1:1:web:cd") }, "installation id"],
    ["POST", fetchUrl, {}, "installation id"],
    ["POST", fetchUrl, { headers: { "x-goog-api-key": "K2" }, postData: fetchBody() }, "key"],
    ["POST", fetchUrl.replace("p-web", "other"), { postData: fetchBody() }, "path"],
    ["POST", fetchUrl.replace("firebase:", "firebase-server:"), { postData: fetchBody() }, "path"],
    ["POST", fetchUrl.replace("key=K1", "key=K2"), { postData: fetchBody() }, "query"],
    ["POST", `${fetchUrl}&x=1`, { postData: fetchBody() }, "query"],
    ["GET", fetchUrl, {}, "method"],
    // Realtime: the key header is required and must be the context's; the body names it.
    ["POST", streamUrl, { postData: streamBody() }, "key"],
    ["POST", streamUrl, { headers: { "x-goog-api-key": "K2" }, postData: streamBody() }, "key"],
    ["POST", streamUrl, { ...keyed, postData: streamBody(other) }, "installation id"],
    ["POST", streamUrl, { ...keyed, postData: streamBody(fid, "1:1:web:cd") }, "installation id"],
    [
      "POST",
      streamUrl,
      { ...keyed, postData: streamBody(fid, "1:1:web:ab", "x") },
      "installation id",
    ],
    ["POST", streamUrl.replace("key=K1", "key=K2"), { ...keyed, postData: streamBody() }, "query"],
    ["POST", streamUrl.replace("realtime.", "."), { ...keyed, postData: streamBody() }, "path"],
  ])
    assert.equal(
      ask(method, href, options),
      reason,
      `${method} ${href} ${JSON.stringify(options)}`,
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

/** A pass directory with run.json (a pid that has exited) and the given files, aged `ageMs`. */
async function passDir(t, files = {}, { ageMs = 3_600_000, pid, lockPid } = {}) {
  const { mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "rc-closure-b-a2-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // The live layout: <base>/rc-closure/send-web-1 beside <base>/sandbox-locks.
  const dir = join(root, "rc-closure");
  const pass = join(dir, "send-web-1");
  mkdirSync(pass, { recursive: true });
  mkdirSync(join(root, "sandbox-locks"));
  const gone = pid ?? spawnSync(process.execPath, ["-e", ""]).pid;
  if (lockPid !== null)
    writeFileSync(
      join(root, "sandbox-locks", "fireemu-oracle-query.lock"),
      JSON.stringify({
        pid: lockPid ?? spawnSync(process.execPath, ["-e", ""]).pid,
        packetId: "RC-CLOSURE-B-V1-3",
        pass: 1,
      }),
    );
  const all = { "run.json": { runId: "261125000000abc", pid: gone }, ...files };
  const at = (Date.now() - ageMs) / 1000;
  for (const [name, body] of Object.entries(all)) {
    writeFileSync(join(pass, name), typeof body === "string" ? body : JSON.stringify(body));
    utimesSync(join(pass, name), at, at);
  }
  return { dir, pass };
}
// A2 in these tests can never reach production: no token and no fetch are ever available.
const offline = {
  token: () => {
    throw new Error("test: no token");
  },
  fetchImpl: () => {
    throw new Error("test: no network");
  },
};

test("ruling 18 item 7: A2 needs the recorder gone, a checkpoint of the run and ten quiet minutes", async (t) => {
  const { a2Refusal } = await import("./record.mjs");
  const result = { "result.json": { runId: "261125000000abc" } };
  // Admitted: a completion checkpoint, the pid gone, an hour old.
  assert.equal(a2Refusal((await passDir(t, result)).pass), null);
  assert.equal(
    a2Refusal((await passDir(t, { "interrupted.json": { runId: "261125000000abc" } })).pass),
    null,
  );
  for (const [files, options, reason] of [
    [{}, {}, /no completion or interruption checkpoint/],
    [{ "result.json": { runId: "other" } }, {}, /no completion or interruption checkpoint/],
    [{ "result.json": "{" }, {}, /no completion or interruption checkpoint/],
    [result, { ageMs: 9 * 60_000 }, /10 minutes after the pass's last activity/],
    [
      { "run.json": { runId: "261125000000abc" }, ...result },
      {},
      /no run.json with its runId and pid/,
    ],
    [{ "run.json": "x", ...result }, {}, /no run.json/],
  ])
    assert.match(a2Refusal((await passDir(t, files, options)).pass), reason, JSON.stringify(files));
  // A live recorder (pid and command) refuses; a reused pid with another command does not.
  const { spawn } = await import("node:child_process");
  const alive = spawn(process.execPath, [
    "-e",
    "setTimeout(() => {}, 60000)",
    "remote-config-web/record.mjs",
  ]);
  t.after(() => alive.kill());
  assert.match(
    a2Refusal((await passDir(t, result, { pid: alive.pid })).pass),
    /recorder is still running/,
  );
  // Where ps can read a live process's command (not under the mutation sandbox), a pid reused by
  // another command does not hold A2 back; where it cannot, the pid counts as the recorder.
  const { spawnSync } = await import("node:child_process");
  const readable = spawnSync("/bin/ps", ["-p", String(process.pid), "-o", "args="]).status === 0;
  const reused = a2Refusal((await passDir(t, result, { pid: process.pid })).pass);
  if (readable) assert.equal(reused, null);
  else assert.match(reused, /recorder is still running/);
});

test("ruling 18 item 7: main refuses A2 before it reads a token or creates anything", async (t) => {
  const { existsSync } = await import("node:fs");
  const { dir, pass } = await passDir(
    t,
    { "result.json": { runId: "261125000000abc" } },
    { ageMs: 60_000 },
  );
  let asked = 0;
  await assert.rejects(
    main(
      ["--send-production", "--a2-of", pass, "--out", join(dir, "a2")],
      { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
      {
        ...offline,
        token: () => {
          asked += 1;
          throw new Error("test: no token");
        },
      },
    ),
    /10 minutes after the pass's last activity/,
  );
  assert.equal(asked, 0);
  assert.equal(existsSync(join(dir, "a2")), false);
  const { pass: early } = await passDir(t, {});
  await assert.rejects(
    main(
      ["--send-production", "--a2-of", early, "--out", join(dir, "a2b")],
      { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER },
      offline,
    ),
    /checkpoint/,
  );
});

test("ruling 18 item 2: a pass is closed only by its complete result, an A2 of it, or an acceptance record", async (t) => {
  const { closureRefusal } = await import("./record.mjs");
  const { mkdirSync, writeFileSync, realpathSync } = await import("node:fs");
  const runId = "261125000000abc";
  const complete = {
    runId,
    complete: true,
    stopped: null,
    open: [],
    unknown: [],
    refusals: [],
    leakCheck: "done",
  };
  const verdict = async (result, { a2, acceptance, ledger = "", extra = {} } = {}) => {
    const { dir, pass } = await passDir(t, {
      ...(result ? { "result.json": result } : {}),
      ...extra,
    });
    const real = realpathSync(pass);
    if (a2) {
      mkdirSync(`${pass}-a2-1`);
      const meta = a2.meta ?? { runId, a2Of: real };
      writeFileSync(join(`${pass}-a2-1`, "run.json"), JSON.stringify(meta));
      writeFileSync(
        join(`${pass}-a2-1`, "a2.json"),
        JSON.stringify(
          a2.back ?? {
            runId,
            a2Of: real,
            atBaseline: true,
            clientEmpty: true,
            keyListComplete: true,
            errors: [],
            keys: [],
            requests: 2,
            ...a2.patch,
          },
        ),
      );
    }
    if (acceptance) writeFileSync(`${pass}-acceptance.json`, JSON.stringify(acceptance));
    writeFileSync(join(dir, "owner.md"), ledger);
    return closureRefusal(pass, join(dir, "owner.md"));
  };
  assert.equal(await verdict(complete), null);
  // A complete flag with an item, an unknown answer or a refusal beside it is not complete.
  for (const bad of [
    { ...complete, open: ["x"] },
    { ...complete, unknown: ["t1-publish"] },
    { ...complete, refusals: [{}] },
    { ...complete, stopped: "x" },
    { ...complete, runId: "other" },
  ])
    assert.ok(await verdict(bad), JSON.stringify(bad));
  const stopped = {
    runId,
    complete: false,
    stopped: "x",
    open: [],
    unknown: ["a-keys"],
    refusals: [],
    leakCheck: "done",
  };
  assert.equal(await verdict(stopped, { a2: {} }), null);
  // Ruling 20: a leak check that did not finish is open, for closure 1 and closure 2 alike.
  assert.ok(await verdict({ ...complete, leakCheck: "pending" }));
  assert.match(
    await verdict({ ...stopped, leakCheck: "pending" }, { a2: {} }),
    /no acceptance or recovery record/,
  );
  // An A2 that holds only atBaseline, names another run or directory, or has an error, closes nothing.
  for (const a2 of [
    { back: { atBaseline: true } },
    { meta: { runId: "other", a2Of: "x" } },
    {
      back: {
        runId,
        a2Of: "/elsewhere",
        atBaseline: true,
        clientEmpty: true,
        keyListComplete: true,
        errors: [],
      },
    },
    {
      back: {
        runId,
        a2Of: null,
        atBaseline: true,
        clientEmpty: true,
        keyListComplete: true,
        errors: ["x"],
      },
    },
    // run.json naming another directory; an a2.json at baseline whose template or key list is not.
    { meta: { runId, a2Of: "/elsewhere" } },
    { patch: { clientEmpty: false } },
    { patch: { keyListComplete: false } },
  ])
    assert.match(
      await verdict(stopped, { a2 }),
      /no A2 of its run at baseline/,
      JSON.stringify(a2),
    );
  // Open items are never closed by an A2 at baseline alone (an unknown create, an installation).
  const KEY_OPEN = "k-create: the key may exist until its deletion is read back (A2 lists keys)";
  const open = {
    ...stopped,
    open: [KEY_OPEN, "g-one: installation deletion not proved on the wire (0 of 1)"],
  };
  assert.match(await verdict(open, { a2: {} }), /no acceptance or recovery record/);
  const record = { runId, open: open.open, kind: "owner-acceptance", ledgerLine: 2 };
  const line = `- 2026-11-26 | RC-CLOSURE-B decision | packetId=RC-CLOSURE-B-V1-3 runId=${runId} decision=accept | owner | chat 2026-11-26`;
  assert.equal(await verdict(open, { a2: {}, acceptance: record, ledger: `x\n${line}\n` }), null);
  for (const [acceptance, ledger] of [
    [{ ...record, open: [KEY_OPEN] }, `x\n${line}\n`],
    [{ ...record, runId: "other" }, `x\n${line}\n`],
    [{ ...record, kind: "self" }, `x\n${line}\n`],
    [{ ...record, ledgerLine: 1 }, `x\n${line}\n`],
    // Matched by exact fields, never by substrings (ruling 19 item 4).
    [record, `x\n${line.replace("decision=accept", "decision=recovery")}\n`],
    [record, `x\n- 2026-11-26 | RC-CLOSURE-B ${runId} owner did not accept | owner | x\n`],
    [record, `x\n${line.replace("decision=accept", "decision=accept-pending")}\n`],
    [record, `x\n${line.replace("decision=accept", "decision=accept not")}\n`],
    [record, `x\n${line.replace("RC-CLOSURE-B-V1-3", "RC-CLOSURE-B-V1-2")}\n`],
    [record, `x\n${line.replace(runId, "261125000000abd")}\n`],
    [record, `x\n${line.replace("| owner |", "| coordinator |")}\n`],
    [record, `x\n${line} | extra\n`],
  ])
    assert.ok(await verdict(open, { a2: {}, acceptance, ledger }), JSON.stringify(acceptance));
  assert.match(await verdict(open, { acceptance: record, ledger: `x\n${line}\n` }), /no A2/);
  // A pass ended by a signal is open as `interrupted`.
  const interrupted = { "interrupted.json": { runId, signal: "SIGTERM" } };
  assert.match(await verdict(null, { a2: {}, extra: interrupted }), /no acceptance/);
  assert.equal(
    await verdict(null, {
      a2: {},
      extra: interrupted,
      acceptance: { runId, open: ["interrupted"], kind: "recovery", ledgerLine: 1 },
      ledger: `${line.replace("decision=accept", "decision=recovery")}\n`,
    }),
    null,
  );
  assert.match(await verdict(null), /no result.json of its run/);
});

test("ruling 18 item 6: A2 is at baseline only for the baseline's shape and a complete key list", async () => {
  const { readBack } = await import("./record.mjs");
  const u = adminUrls(PROJECT);
  const transport = (client, keys, keysStatus = 200) => ({
    count: 2,
    send: async (caseId) =>
      caseId === "a2-client" ? { status: 200, json: client } : { status: keysStatus, json: keys },
  });
  const base = { version: { versionNumber: "46" } };
  const deleted = {
    displayName: KEY_ID,
    name: `projects/${NUMBER}/locations/global/keys/k0`,
    deleteTime: "2026-11-25T00:00:00.123Z",
  };
  const back = await readBack(transport(base, { keys: [deleted] }), u, { runId: "r", a2Of: "/d" });
  assert.deepEqual([back.atBaseline, back.runId, back.a2Of], [true, "r", "/d"]);
  assert.equal((await readBack(transport(base, {}), u)).atBaseline, true);
  for (const [client, keys, status] of [
    [{}, { keys: [] }],
    [{ version: { versionNumber: "" } }, { keys: [] }],
    [{ ...base, parameterGroups: {} }, { keys: [] }],
    [{ ...base, parameters: { a: {} } }, { keys: [] }],
    [base, { error: { code: 500 } }],
    [base, { keys: [], nextPageToken: "" }],
    [base, { keys: "x" }],
    [base, { keys: [] }, 403],
    [base, { keys: [{ ...deleted, deleteTime: "" }] }],
    [base, { keys: [{ ...deleted, deleteTime: "yesterday" }] }],
    [base, { keys: [{ displayName: KEY_ID }] }],
  ])
    assert.equal(
      (await readBack(transport(client, keys, status), u)).atBaseline,
      false,
      JSON.stringify([client, keys, status]),
    );
});

test("ruling 18 item 8: main refuses the variables that would move the browser or its diagnostics", async (t) => {
  const { REFUSED_ENV } = await import("./record.mjs");
  const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of [
    "SELENIUM_REMOTE_URL",
    "SELENIUM_REMOTE_HEADERS",
    "SELENIUM_REMOTE_CAPABILITIES",
    "PLAYWRIGHT_BROWSERS_PATH",
    "PW_CHROMIUM_ATTACH_TO_OTHER",
    "DEBUG",
  ]) {
    assert.ok(REFUSED_ENV.includes(name));
    await assert.rejects(
      main(
        ["--send-production", "--out", join(dir, "run")],
        { FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER, [name]: "x" },
        offline,
      ),
      new RegExp(`${name} must not be set`),
    );
  }
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

test("ruling 18 item 3: the leak check masks every output file holding the key or a page's secret", async (t) => {
  const { leakCheck } = await import("./record.mjs");
  const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-leak-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "journal.jsonl"), '{"etag":"AIzaLEAK"}\n');
  writeFileSync(join(dir, "wire-one.json"), '{"path":"/installations/cRAWFID000000000000000"}\n');
  writeFileSync(join(dir, "result.json"), '{"ok":true}\n');
  mkdirSync(join(dir, "sub"));
  const browser = { mask: async (text) => text.split("cRAWFID000000000000000").join("FID_1") };
  const leaked = await leakCheck(dir, new Set(["AIzaLEAK"]), browser);
  assert.deepEqual(leaked.toSorted(), ["journal.jsonl", "wire-one.json"]);
  assert.equal(readFileSync(join(dir, "journal.jsonl"), "utf8"), '{"etag":"API_KEY"}\n');
  assert.ok(readFileSync(join(dir, "wire-one.json"), "utf8").includes("FID_1"));
  assert.deepEqual(await leakCheck(dir, new Set(["AIzaLEAK"]), browser), []);
});

test("ruling 18 item 6: the baseline has exactly the recorded empty shape; deletion times are RFC 3339", async () => {
  const { baselineEmpty, isDeleted } = await import("./program.mjs");
  assert.equal(baselineEmpty({ version: { versionNumber: "46", description: "x" } }), true);
  for (const doc of [
    {},
    null,
    [],
    { version: {} },
    { version: { versionNumber: "0" } },
    { version: { versionNumber: 46 } },
    { version: { versionNumber: "46" }, parameters: {} },
    { version: { versionNumber: "46" }, conditions: [] },
    { version: { versionNumber: "46" }, etag: "x" },
  ])
    assert.equal(baselineEmpty(doc), false, JSON.stringify(doc));
  assert.equal(isDeleted({ deleteTime: "2026-11-25T00:00:00Z" }), true);
  assert.equal(isDeleted({ deleteTime: "2026-11-25T00:00:00.123456789Z" }), true);
  for (const deleteTime of ["", "2026-11-25", "x", "2026-11-25T00:00:00+09:00", 0, undefined])
    assert.equal(isDeleted({ deleteTime }), false, String(deleteTime));
});

// ---- RC-CLOSURE-B v1.3 (ruling 19) ----

test("ruling 19 items 1 and 3: A2 sends nothing after a 403 or 429, and accepts only well-formed keys and real instants", async () => {
  const { readBack } = await import("./record.mjs");
  const u = adminUrls(PROJECT);
  const base = { version: { versionNumber: "46" } };
  for (const status of [403, 429]) {
    const sent = [];
    const back = await readBack(
      {
        get count() {
          return sent.length;
        },
        send: async (caseId) => {
          sent.push(caseId);
          return { status, json: { error: { code: status } } };
        },
      },
      u,
    );
    assert.deepEqual(sent, ["a2-client"]);
    assert.equal(back.atBaseline, false);
    assert.equal(back.requests, 1);
  }
  const transport = (keys) => ({
    count: 2,
    send: async (caseId) =>
      caseId === "a2-client" ? { status: 200, json: base } : { status: 200, json: keys },
  });
  const key = (extra = {}) => ({
    name: `projects/${NUMBER}/locations/global/keys/k0`,
    displayName: KEY_ID,
    deleteTime: "2026-11-26T00:00:00Z",
    ...extra,
  });
  assert.equal((await readBack(transport({ keys: [key()] }), u)).atBaseline, true);
  for (const keys of [
    { keys: [null] },
    { keys: ["x"] },
    { keys: [{}] },
    { keys: [key({ name: "k0" })] },
    { keys: [key({ displayName: 7 })] },
    { keys: [key({ deleteTime: "2026-02-30T00:00:00Z" })] },
    { keys: [key({ deleteTime: "2026-11-26T24:00:00Z" })] },
    { keys: [key(), null] },
  ])
    assert.equal((await readBack(transport(keys), u)).atBaseline, false, JSON.stringify(keys));
  const { isInstant } = await import("./program.mjs");
  for (const ok of ["2026-11-26T00:00:00Z", "2024-02-29T23:59:59.123456789Z"])
    assert.ok(isInstant(ok), ok);
  for (const bad of [
    "2026-02-30T00:00:00Z",
    "2025-02-29T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-11-26T23:60:00Z",
    "2026-11-26T00:00:60Z",
    "2026-11-31T00:00:00Z",
  ])
    assert.equal(isInstant(bad), false, bad);
});

test("ruling 19 item 7: a stream that ended with an error is a page problem; the listener's own close is not", async () => {
  const { pageProblem } = await import("./program.mjs");
  const stream = { host: "h", method: "POST", path: "/v1/x:streamFetchInvalidations", status: 200 };
  assert.equal(pageProblem([{ ...stream, ended: "done" }], []), null);
  assert.equal(pageProblem([{ ...stream, ended: "error:AbortError" }], []), null);
  assert.match(
    pageProblem([{ ...stream, ended: "error:TypeError" }], []),
    /stream ended with TypeError/,
  );
});

test("ruling 19 item 7: the recorder's A2 makes the launcher's lock-holder check", async (t) => {
  const { a2Refusal } = await import("./record.mjs");
  const { spawn } = await import("node:child_process");
  const result = { "result.json": { runId: "261125000000abc" } };
  assert.equal(a2Refusal((await passDir(t, result)).pass), null);
  assert.match(
    a2Refusal((await passDir(t, result, { lockPid: null })).pass),
    /project lock is not held/,
  );
  const launcher = spawn("/bin/bash", [
    "-c",
    "sleep 60 & c=$!; trap 'kill $c' TERM; wait $c",
    "launch-b13.sh",
  ]);
  t.after(() => launcher.kill());
  assert.match(
    a2Refusal((await passDir(t, result, { lockPid: launcher.pid })).pass),
    /launcher is still running/,
  );
});

test("ruling 19 item 2: the transport masks a known secret before the body's first write", async (t) => {
  const { Transport } = await import("../remote-config-observe/transport.mjs");
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-redact-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const secrets = new Set(["AIzaSECRET"]);
  const transport = new Transport({
    out: dir,
    allow: () => true,
    token: () => "t",
    maxRequests: 2,
    timeoutMs: 1000,
    redact: (text) => [...secrets].reduce((out, s) => out.split(s).join("API_KEY"), text),
    fetchImpl: async () =>
      new Response(JSON.stringify({ version: { description: "x AIzaSECRET" } }), { status: 200 }),
  });
  const answer = await transport.send("g-client", "https://example.com/x");
  // The caller sees the answer; the file never held the secret.
  assert.equal(answer.json.version.description, "x AIzaSECRET");
  const body = readdirSync(dir).find((f) => f.endsWith(".body"));
  assert.equal(readFileSync(join(dir, body), "utf8"), '{"version":{"description":"x API_KEY"}}');
  const row = readFileSync(join(dir, "journal.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .at(-1);
  assert.equal(row.redacted, true);
});

// ---- ruling 20 (round-4 Musts and Shoulds) ----

test("ruling 20: the journal's copies of header values are masked; the status is known at the headers", async (t) => {
  const { Transport } = await import("../remote-config-observe/transport.mjs");
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "rc-closure-b-headers-"));
  t.after(() => rmSync(dir, { recursive: true, forced: true, force: true }));
  const statuses = [];
  const transport = new Transport({
    out: dir,
    allow: () => true,
    token: () => "t",
    maxRequests: 2,
    timeoutMs: 1000,
    redact: (text) => text.split("AIzaSECRET").join("API_KEY"),
    fetchImpl: async () =>
      new Response("{}", {
        status: 200,
        headers: { etag: '"AIzaSECRET"', "content-type": "application/json; p=AIzaSECRET" },
      }),
  });
  transport.onStatus = (caseId, status) => statuses.push([caseId, status]);
  const answer = await transport.send("g-client", "https://example.com/x", {
    ifMatch: "AIzaSECRET-1",
  });
  assert.equal(answer.etag, '"AIzaSECRET"');
  const journal = readFileSync(join(dir, "journal.jsonl"), "utf8");
  assert.ok(!journal.includes("AIzaSECRET"), journal);
  assert.match(journal, /API_KEY-1/);
  assert.deepEqual(statuses, [["g-client", 200]]);
  assert.ok(readdirSync(dir).length >= 2);
});

test("ruling 20: the owner's decision line never carries an envelope id; a direct A2 checks the lock's packet and pass", async (t) => {
  const { ownerDecision, a2Refusal } = await import("./record.mjs");
  const line =
    "- 2026-11-26 | RC-CLOSURE-B decision | packetId=RC-CLOSURE-B-V1-3 runId=r1 decision=accept | owner | chat";
  assert.ok(ownerDecision(line, "r1", "accept"));
  assert.equal(
    ownerDecision(`${line} envelopeId=RC-CLOSURE-B-20261125-01 x`, "r1", "accept"),
    false,
  );
  const { writeFileSync } = await import("node:fs");
  const result = { "result.json": { runId: "261125000000abc" } };
  const { pass } = await passDir(t, result);
  assert.equal(a2Refusal(pass), null);
  const lock = join(pass, "..", "..", "sandbox-locks", "fireemu-oracle-query.lock");
  for (const body of [
    { pid: 999999, packetId: "RC-CLOSURE-B-V1-3", pass: 2 },
    { pid: 999999, packetId: "RC-CLOSURE-B-V1-2", pass: 1 },
    { pid: 999999 },
  ]) {
    writeFileSync(lock, JSON.stringify(body));
    assert.match(a2Refusal(pass), /not this packet's lock for this pass/, JSON.stringify(body));
  }
});
