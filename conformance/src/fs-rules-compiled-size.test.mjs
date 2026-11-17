import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recordCommand,
  planFor,
  planDigest,
  planText,
  main,
} from "./fs-rules-compiled-size/cli.mjs";
import {
  CHAIN_DEPTH,
  MAX_CHAIN_DEPTH,
  SOURCE_LIMIT_BYTES,
  buildExpansionSource,
  buildPaddedSource,
  copyLadder,
  recomputeCorpus,
} from "./fs-rules-compiled-size/corpus.mjs";
import { rulesUrlFor, runLocal } from "./fs-rules-compiled-size/local.mjs";
import {
  RefusedRequest,
  RequestCapReached,
  createGuardedClient,
  maskText,
  requestCapFor,
  runObserver,
  urls,
} from "./fs-rules-compiled-size/session.mjs";
import { TASK_BY_MODE, taskIdForMode } from "./fs-data-write-admission.mjs";

const TOKEN = "fake-token-aaaaaaaaaaaaaaaa";
const PROJECT = "fireemu-oracle-sbx";
const FAKE_NUMBER = "1".repeat(12);
const NOW = Date.parse("2026-01-02T03:04:05Z");

const json = (status, body) => ({ status, text: async () => JSON.stringify(body) });
const raw = (status, text) => ({ status, text: async () => text });

/** A fake production world: rulesets, releases, failure hooks and a request log. */
function makeWorld({
  baseline = 2,
  decide = () => null,
  hook = () => null,
  pageLimit = 1000,
} = {}) {
  const world = {
    rulesets: new Map(),
    releases: {
      releases: [{ name: `projects/${PROJECT}/releases/cloud.firestore`, rulesetName: "x" }],
    },
    log: [],
    nextId: 0,
    mutateReleasesOnList: false,
  };
  for (let index = 0; index < baseline; index += 1) {
    world.rulesets.set(`projects/${PROJECT}/rulesets/base-${index}`, NOW - 1_000_000);
  }
  const create = () => {
    world.nextId += 1;
    const name = `projects/${PROJECT}/rulesets/new-${world.nextId}`;
    world.rulesets.set(name, NOW + world.nextId * 1000);
    return name;
  };
  world.create = create;
  world.fetch = async (url, init) => {
    const parsed = new URL(url);
    const entry = {
      method: init.method,
      host: parsed.host,
      path: parsed.pathname + parsed.search,
      headers: init.headers,
      redirect: init.redirect,
      body: init.body,
    };
    world.log.push(entry);
    const injected = hook(entry, world);
    if (injected) return injected;
    const path = parsed.pathname;
    if (init.method === "GET" && path.endsWith("/releases")) return json(200, world.releases);
    if (init.method === "GET" && path.endsWith("/rulesets")) {
      const all = [...world.rulesets].map(([name, time]) => ({
        name,
        createTime: new Date(time).toISOString(),
      }));
      const start = Number(parsed.searchParams.get("pageToken") ?? 0);
      const page = all.slice(start, start + pageLimit);
      return json(200, {
        rulesets: page,
        ...(start + pageLimit < all.length ? { nextPageToken: String(start + pageLimit) } : {}),
      });
    }
    if (init.method === "POST") {
      const content = JSON.parse(init.body).source.files[0].content;
      const refusal = decide(content);
      if (refusal) return json(400, refusal);
      return json(200, { name: create(content), source: { files: [] } });
    }
    if (init.method === "DELETE") {
      const name = path.slice(4);
      if (!world.rulesets.delete(name))
        return json(404, { error: { code: 404, status: "NOT_FOUND" } });
      return json(200, {});
    }
    return json(500, {});
  };
  return world;
}

const corpus = recomputeCorpus();
const small = corpus.rungs.slice(0, 3);
const observe = (world, extra = {}) =>
  runObserver({
    fetchImpl: world.fetch,
    token: TOKEN,
    project: PROJECT,
    rungs: small,
    now: () => NOW,
    ...extra,
  });
const posts = (world) => world.log.filter((entry) => entry.method === "POST");

// ---- corpus ----------------------------------------------------------------------------

test("corpus: exact lengths, spacing, depth and no project id", () => {
  const { rungs, ladder } = corpus;
  const controls = rungs.filter((rung) => rung.kind === "size-control");
  assert.deepEqual(
    controls.map((rung) => rung.byteLength),
    [SOURCE_LIMIT_BYTES, SOURCE_LIMIT_BYTES + 1],
  );
  for (const rung of rungs) {
    assert.equal(rung.byteLength, Buffer.byteLength(rung.source, "utf8"));
    assert.match(rung.sha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(rung.source, /fireemu|oracle|sbx/i);
    if (rung.byteLength !== SOURCE_LIMIT_BYTES + 1)
      assert.ok(rung.byteLength <= SOURCE_LIMIT_BYTES);
  }
  assert.equal(new Set(rungs.map((rung) => rung.id)).size, rungs.length);
  assert.equal(ladder[0].leafCount, 2 ** CHAIN_DEPTH);
  assert.equal(ladder.at(-1).leafCount, 2 ** 16);
  for (let index = 1; index < ladder.length; index += 1) {
    const ratio = ladder[index].leafCount / ladder[index - 1].leafCount;
    assert.ok(ladder[index].leafCount > ladder[index - 1].leafCount);
    if (ladder[index - 1].copies >= 8) assert.ok(ratio >= 1.1 && ratio <= 1.25, `ratio ${ratio}`);
  }
  assert.ok(ladder.length >= 20 && ladder.length <= 22);
  assert.ok(CHAIN_DEPTH <= MAX_CHAIN_DEPTH);
  assert.equal(recomputeCorpus().digest, corpus.digest);
});

test("corpus: source shapes", () => {
  const source = buildExpansionSource(2, 3);
  assert.match(source, /function f0\(x\) \{ return x == 1; \}/);
  assert.match(source, /function f2\(x\) \{ return f1\(x\) \|\| f1\(x\); \}/);
  assert.match(source, /function fx\(x\) \{ return f2\(x\) \|\| f2\(x\) \|\| f2\(x\); \}/);
  assert.throws(() => buildExpansionSource(20, 1), RangeError);
  assert.throws(() => buildExpansionSource(3, 0), RangeError);
  assert.throws(() => buildPaddedSource(10), RangeError);
});

test("property: every rung has its exact byte length and a monotone ladder", () => {
  const copies = copyLadder();
  for (let depth = 1; depth <= MAX_CHAIN_DEPTH; depth += 1) {
    for (const k of [1, 2, 7, 64]) {
      const source = buildExpansionSource(depth, k);
      assert.ok(Buffer.byteLength(source) < SOURCE_LIMIT_BYTES);
      assert.equal(source.match(/function /g).length, depth + 2);
    }
  }
  for (let index = 1; index < copies.length; index += 1)
    assert.ok(copies[index] > copies[index - 1]);
  for (const bytes of [
    400,
    1000,
    4096,
    SOURCE_LIMIT_BYTES - 1,
    SOURCE_LIMIT_BYTES,
    SOURCE_LIMIT_BYTES + 1,
  ]) {
    assert.equal(Buffer.byteLength(buildPaddedSource(bytes)), bytes);
  }
});

test("plan: cap, digest and text are stable", () => {
  const plan = planFor(corpus);
  assert.equal(plan.requestCap, requestCapFor(corpus.rungs.length));
  assert.equal(planDigest(plan), planDigest(planFor(recomputeCorpus())));
  assert.match(planText(corpus), /request cap: \d+/);
});

// ---- guard -----------------------------------------------------------------------------

function guardedClient(overrides = {}) {
  const world = makeWorld();
  const client = createGuardedClient({
    fetchImpl: world.fetch,
    token: TOKEN,
    project: PROJECT,
    cap: 50,
    ...overrides,
  });
  return { world, client };
}

test("guard: refuses releases mutations, other hosts, projects and paths", async () => {
  const { world, client } = guardedClient();
  const releases = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`;
  const refused = [
    { method: "POST", url: releases },
    { method: "PATCH", url: `${releases}/cloud.firestore` },
    { method: "PUT", url: `${releases}/cloud.firestore` },
    { method: "DELETE", url: `${releases}/cloud.firestore` },
    { method: "GET", url: `${releases}/cloud.firestore` },
    { method: "GET", url: `${releases}?pageSize=1` },
    { method: "POST", url: `https://example.com/v1/projects/${PROJECT}/rulesets` },
    {
      method: "GET",
      url: `https://firebaserules.googleapis.com.evil.test/v1/projects/${PROJECT}/rulesets?pageSize=100`,
    },
    {
      method: "GET",
      url: `http://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets?pageSize=100`,
    },
    {
      method: "POST",
      url: "https://firebaserules.googleapis.com/v1/projects/other-project/rulesets",
    },
    {
      method: "GET",
      url: "https://firebaserules.googleapis.com/v1/projects/other-project/rulesets?pageSize=100",
    },
    {
      method: "GET",
      url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets?pageSize=100&filter=x`,
    },
    {
      method: "GET",
      url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/abc`,
    },
    {
      method: "DELETE",
      url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/not-ours`,
    },
    {
      method: "DELETE",
      url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/base-0`,
    },
    {
      method: "POST",
      url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets:test`,
    },
    {
      method: "POST",
      url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets?x=1`,
    },
    { method: "GET", url: "not a url" },
  ];
  for (const request of refused) {
    await assert.rejects(
      () => client.send(request),
      RefusedRequest,
      `${request.method} ${request.url}`,
    );
  }
  assert.equal(world.log.length, 0);
  assert.equal(client.count, 0);
  assert.throws(
    () => createGuardedClient({ fetchImpl: world.fetch, token: TOKEN, project: "other", cap: 5 }),
    RefusedRequest,
  );
  assert.throws(
    () => createGuardedClient({ fetchImpl: world.fetch, token: "", project: PROJECT, cap: 5 }),
    RefusedRequest,
  );
  await assert.rejects(
    () => runObserver({ fetchImpl: world.fetch, token: TOKEN, project: "other", rungs: small }),
    RefusedRequest,
  );
});

test("guard: delete refuses a baseline name even when authorized", async () => {
  const { client } = guardedClient();
  client.protect([`projects/${PROJECT}/rulesets/base-0`]);
  assert.throws(
    () => client.authorizeDelete(`projects/${PROJECT}/rulesets/base-0`),
    RefusedRequest,
  );
});

test("guard: headers, redirect mode and the request cap", async () => {
  const { world, client } = guardedClient({ cap: 2 });
  await client.send({ method: "GET", url: urls.listReleases() });
  await client.send({ method: "GET", url: urls.listRulesets() });
  await assert.rejects(
    () => client.send({ method: "GET", url: urls.listReleases() }),
    RequestCapReached,
  );
  assert.equal(world.log.length, 2);
  assert.equal(client.count, 2);
  for (const entry of world.log) {
    assert.equal(entry.host, "firebaserules.googleapis.com");
    assert.equal(entry.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(entry.headers["x-goog-user-project"], PROJECT);
    assert.equal(entry.redirect, "manual");
  }
});

test("guard: a timeout is an unknown answer and never retried", async () => {
  const hangs = () => new Promise(() => {});
  const client = createGuardedClient({
    fetchImpl: hangs,
    token: TOKEN,
    project: PROJECT,
    cap: 5,
    timeoutMs: 20,
  });
  const res = await client.send({ method: "GET", url: urls.listReleases() });
  assert.equal(res.kind, "timeout");
  assert.equal(client.count, 1);
});

// ---- observer: happy path ----------------------------------------------------------------

test("observer: accepts and refuses, deletes what it created, restores the baseline", async () => {
  const world = makeWorld({
    decide: (content) =>
      content.includes("f10(x) || f10(x) || f10(x)")
        ? {
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: `Invalid argument for project ${FAKE_NUMBER}.`,
              details: [
                { fieldViolations: [{ field: "source", description: `too big (${FAKE_NUMBER})` }] },
              ],
            },
          }
        : null,
  });
  const result = await observe(world);
  assert.equal(result.complete, true, JSON.stringify(result.flags));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    result.rows.map((row) => row.outcome),
    ["accepted", "accepted", "refused"],
  );
  assert.deepEqual(
    result.rows.map((row) => row.cleanup),
    ["deleted", "deleted", "none"],
  );
  assert.equal(result.rows[0].namePresent, true);
  assert.equal(result.rows[2].namePresent, false);
  assert.equal(result.rows[2].errorStatus, "INVALID_ARGUMENT");
  assert.equal(result.rows[2].errorCode, 400);
  assert.equal(world.rulesets.size, 2);
  assert.ok(!world.log.some((entry) => entry.path.includes("/releases") && entry.method !== "GET"));
  assert.equal(world.log.filter((entry) => entry.path.includes("/releases")).length, 2);
  assert.ok(result.requestCount <= result.requestCap);
  const text = JSON.stringify(result.rows, (key, value) => (key === "sha256" ? undefined : value));
  assert.ok(!text.includes(TOKEN));
  assert.doesNotMatch(text, /\d{12}/);
  assert.match(text, /<NUMBER>/);
  assert.equal(maskText(`a${FAKE_NUMBER}b`), "a<NUMBER>b");
});

test("observer: field violations are kept verbatim", async () => {
  const world = makeWorld({
    decide: () => ({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "m",
        details: [{ fieldViolations: [{ field: "source", description: "L1:1 limit exceeded" }] }],
      },
    }),
  });
  const result = await observe(world);
  assert.deepEqual(result.rows[0].body.error.details[0].fieldViolations, [
    { field: "source", description: "L1:1 limit exceeded" },
  ]);
});

// ---- observer: unknown-answer rules --------------------------------------------------------

test("observer: unknown create then a 404 list stays open and exits non-zero", async () => {
  const world = makeWorld({
    hook: (entry, w) => {
      if (entry.method === "POST" && w.nextId === 0) {
        w.create("x");
        return json(503, {});
      }
      if (
        entry.method === "GET" &&
        entry.path.includes("/rulesets") &&
        w.nextId > 0 &&
        w.log.filter((e) => e.method === "GET" && e.path.includes("/rulesets")).length >= 2
      ) {
        return json(404, {});
      }
      return null;
    },
  });
  const result = await observe(world);
  assert.equal(result.complete, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.rows[0].outcome, "unknown");
  assert.equal(result.rows[0].cleanup, "unconfirmed");
  assert.ok(result.flags.includes(`unconfirmed-create:${small[0].id}`));
  assert.ok(!world.log.some((entry) => entry.method === "DELETE" && entry.path.includes("new-1")));
});

test("observer: unknown create then an empty 200 list is not settled either", async () => {
  const world = makeWorld({ hook: (entry) => (entry.method === "POST" ? json(502, {}) : null) });
  const result = await observe(world);
  assert.equal(result.complete, false);
  assert.ok(result.rows.every((row) => row.cleanup === "unconfirmed"));
});

test("observer: unknown create then a list showing the name is deleted and settled", async () => {
  let first = true;
  const world = makeWorld({
    hook: (entry, w) => {
      if (entry.method === "POST" && first) {
        first = false;
        w.create("x");
        return raw(504, "<html>gateway</html>");
      }
      return null;
    },
  });
  const result = await observe(world);
  assert.equal(result.rows[0].outcome, "unknown");
  assert.equal(result.rows[0].cleanup, "settled-by-list");
  assert.equal(result.complete, true, JSON.stringify(result.flags));
  assert.equal(world.rulesets.size, 2);
});

test("observer: ambiguous strays are never deleted", async () => {
  let first = true;
  const world = makeWorld({
    hook: (entry, w) => {
      if (entry.method === "POST" && first) {
        first = false;
        w.create("x");
        w.create("y");
        return json(500, {});
      }
      return null;
    },
  });
  const result = await observe(world);
  assert.equal(result.complete, false);
  assert.ok(result.flags.some((flag) => flag.startsWith("ambiguous-strays")));
  assert.ok(!world.log.some((entry) => entry.method === "DELETE" && /new-(1|2)$/.test(entry.path)));
});

test("observer: unreadable 2xx and 4xx bodies are unknown, a 3xx and a 429 too", async () => {
  for (const response of [
    raw(200, "not json"),
    raw(400, ""),
    raw(302, ""),
    json(429, {}),
    raw(100, ""),
  ]) {
    const world = makeWorld({ hook: (entry) => (entry.method === "POST" ? response : null) });
    const result = await observe(world);
    assert.equal(result.rows[0].outcome, "unknown", String(response.status));
    assert.equal(result.complete, false);
  }
});

test("observer: a 2xx create then 404 on its own delete is settled", async () => {
  const world = makeWorld({
    hook: (entry, w) => {
      if (entry.method === "DELETE") {
        w.rulesets.delete(entry.path.slice(4));
        return json(404, { error: { code: 404 } });
      }
      return null;
    },
  });
  const result = await observe(world);
  assert.deepEqual(
    result.rows.map((row) => row.cleanup),
    ["absent", "absent", "absent"],
  );
  assert.equal(result.complete, true, JSON.stringify(result.flags));
});

test("observer: a 5xx delete leaves the run incomplete", async () => {
  const world = makeWorld({ hook: (entry) => (entry.method === "DELETE" ? json(503, {}) : null) });
  const result = await observe(world);
  assert.equal(result.complete, false);
  assert.equal(result.exitCode, 1);
  assert.ok(result.rows.every((row) => row.cleanup === "delete-failed"));
  assert.ok(result.flags.includes("baseline-mismatch"));
  assert.equal(result.createdNames.length, 3);
  assert.equal(world.log.filter((entry) => entry.method === "DELETE").length, 3);
});

// ---- observer: stops and flags --------------------------------------------------------------

test("observer: a 401 stops creation and still cleans up", async () => {
  const world = makeWorld({
    hook: (entry, w) =>
      entry.method === "POST" && w.nextId === 1
        ? json(401, { error: { code: 401, status: "UNAUTHENTICATED", message: "expired" } })
        : null,
  });
  const result = await observe(world);
  assert.equal(result.stop, "credential-401");
  assert.deepEqual(
    result.rows.map((row) => row.outcome),
    ["accepted", "credential-stop", "not-attempted"],
  );
  assert.equal(posts(world).length, 2);
  assert.equal(result.rows[0].cleanup, "deleted");
  assert.equal(world.rulesets.size, 2);
  assert.equal(result.complete, false);
});

test("observer: a 403 on the baseline creates nothing", async () => {
  const world = makeWorld({
    hook: (entry) =>
      entry.method === "GET" && entry.path.includes("/rulesets") ? json(403, {}) : null,
  });
  const result = await observe(world);
  assert.equal(result.stop, "baseline-unavailable");
  assert.equal(posts(world).length, 0);
  assert.equal(result.complete, false);
});

test("observer: a changed baseline list or changed releases flags the run", async () => {
  const intruder = makeWorld({
    hook: (entry, w) => {
      if (entry.method === "DELETE") w.rulesets.set(`projects/${PROJECT}/rulesets/intruder`, NOW);
      return null;
    },
  });
  const a = await observe(intruder);
  assert.ok(a.flags.includes("baseline-mismatch"));
  assert.equal(a.complete, false);

  const world = makeWorld({
    hook: (entry, w) => {
      if (entry.method === "DELETE")
        w.releases = { releases: [{ name: "x", rulesetName: "changed" }] };
      return null;
    },
  });
  const b = await observe(world);
  assert.ok(b.flags.includes("releases-changed"));
  assert.equal(b.complete, false);
});

test("observer: a response echoing the token stops the run and is not recorded", async () => {
  const world = makeWorld({
    hook: (entry, w) => {
      if (entry.method === "POST" && w.nextId === 0) {
        const name = w.create("x");
        return raw(200, JSON.stringify({ name, leaked: TOKEN }));
      }
      return null;
    },
  });
  const result = await observe(world);
  assert.equal(result.stop, "token-echo");
  assert.equal(posts(world).length, 1);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.equal(world.rulesets.size, 2);
});

test("observer: paginated lists are read fully", async () => {
  const world = makeWorld({ baseline: 3, pageLimit: 2 });
  const result = await observe(world);
  assert.equal(result.complete, true, JSON.stringify(result.flags));
  assert.equal(result.baselineCount, 3);
});

test("observer: a baseline longer than the page budget creates nothing", async () => {
  const world = makeWorld({ baseline: 5, pageLimit: 2 });
  const result = await observe(world);
  assert.equal(result.stop, "baseline-unavailable");
  assert.equal(posts(world).length, 0);
});

test("observer: the full corpus runs within its request cap", async () => {
  const world = makeWorld({
    decide: (content) =>
      Buffer.byteLength(content) > SOURCE_LIMIT_BYTES
        ? { error: { code: 400, status: "INVALID_ARGUMENT", message: "too large" } }
        : null,
  });
  const result = await runObserver({
    fetchImpl: world.fetch,
    token: TOKEN,
    project: PROJECT,
    rungs: corpus.rungs,
    now: () => NOW,
  });
  assert.equal(result.complete, true, JSON.stringify(result.flags));
  assert.equal(result.requestCap, requestCapFor(corpus.rungs.length));
  assert.equal(result.requestCount, 2 + 2 + corpus.rungs.length * 2 - 1);
  assert.equal(result.rows.at(-1).outcome, "refused");
  assert.equal(result.rows.at(-2).outcome, "accepted");
});

test("property: request count never exceeds the cap under random failures", async () => {
  let seed = 12345;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const statuses = [500, 503, 404, 401, 403, 429, 302, 400];
  for (let round = 0; round < 150; round += 1) {
    const rate = next();
    const world = makeWorld({
      baseline: Math.floor(next() * 4),
      pageLimit: 1 + Math.floor(next() * 3),
      hook: (entry, w) => {
        if (next() >= rate * 0.6) return null;
        const status = statuses[Math.floor(next() * statuses.length)];
        if (next() < 0.3 && entry.method === "POST") w.create("x");
        if (next() < 0.1) return new Promise(() => {});
        return json(status, {});
      },
    });
    const result = await runObserver({
      fetchImpl: world.fetch,
      token: TOKEN,
      project: PROJECT,
      rungs: corpus.rungs.slice(0, 6),
      now: () => NOW,
      timeoutMs: 5,
    });
    assert.ok(world.log.length <= requestCapFor(6), `round ${round}`);
    assert.equal(world.log.length, result.requestCount);
    assert.ok(
      !world.log.some((entry) => entry.path.includes("/releases") && entry.method !== "GET"),
    );
    assert.ok(!world.log.some((entry) => entry.method === "DELETE" && /base-/.test(entry.path)));
    assert.ok(typeof result.complete === "boolean");
  }
});

// ---- record command ----------------------------------------------------------------------------

const admissionEnv = (mode = "rulesize", extra = {}) => ({
  FIRESTORE_PROBE_ADMISSION: JSON.stringify({
    mode,
    nonce: "a".repeat(16),
    reviewSha256: "b".repeat(64),
    planSha256: "c".repeat(64),
    sourceCommit: "d".repeat(40),
    reviewPath: "/x",
  }),
  FIREEMU_RULESIZE_RUN_ID: "e".repeat(32),
  FIREEMU_RULESIZE_TOKEN: TOKEN,
  ...extra,
});

test("record: refuses without admission, with a wrong mode, a bad run id or no token", async () => {
  const fetchImpl = () => {
    throw new Error("must not send");
  };
  const verify = () => ({});
  const base = { fetchImpl, verify, corpus: { ...corpus, rungs: small } };
  await assert.rejects(
    () =>
      recordCommand({
        ...base,
        env: { FIREEMU_RULESIZE_TOKEN: TOKEN, FIREEMU_RULESIZE_RUN_ID: "e".repeat(32) },
      }),
    /admission/,
  );
  await assert.rejects(
    () => recordCommand({ ...base, env: admissionEnv("writelimits") }),
    /mode rulesize/,
  );
  await assert.rejects(
    () =>
      recordCommand({
        ...base,
        env: admissionEnv("rulesize", { FIREEMU_RULESIZE_RUN_ID: "short" }),
      }),
    /run id|RUN_ID/i,
  );
  await assert.rejects(
    () => recordCommand({ ...base, env: admissionEnv("rulesize", { FIREEMU_RULESIZE_TOKEN: "" }) }),
    /TOKEN/,
  );
  const { FIREEMU_RULESIZE_TOKEN: _drop, ...noToken } = admissionEnv();
  await assert.rejects(() => recordCommand({ ...base, env: noToken }), /TOKEN/);
  await assert.rejects(
    () =>
      recordCommand({
        ...base,
        env: { ...admissionEnv(), FIRESTORE_PROBE_ADMISSION: "{not json" },
      }),
    /admission/,
  );
});

test("record: a failing admission check stops before any request", async () => {
  let sent = 0;
  await assert.rejects(
    () =>
      recordCommand({
        env: admissionEnv(),
        fetchImpl: () => ((sent += 1), json(200, {})),
        verify: () => {
          throw new Error("ledger packet missing");
        },
        corpus: { ...corpus, rungs: small },
      }),
    /ledger packet missing/,
  );
  assert.equal(sent, 0);
  // The real on-disk check also refuses these fake pins (nothing reserved them).
  await assert.rejects(() =>
    recordCommand({
      env: admissionEnv(),
      fetchImpl: () => ((sent += 1), json(200, {})),
      corpus: { ...corpus, rungs: small },
    }),
  );
  assert.equal(sent, 0);
});

test("record: with admission and a fake token it observes and prints no secrets", async () => {
  const world = makeWorld();
  const { outcome, text } = await recordCommand({
    env: admissionEnv(),
    fetchImpl: world.fetch,
    verify: () => ({}),
    corpus: { ...corpus, rungs: small },
  });
  assert.equal(outcome.complete, true);
  assert.ok(!text.includes(TOKEN));
  assert.match(JSON.parse(text).planSha256, /^[0-9a-f]{64}$/);
});

test("cli: usage errors and plan output", async () => {
  let out = "";
  assert.equal(await main(["plan"], {}, (text) => (out += text)), 0);
  assert.match(out, /size-ctl-262145/);
  await assert.rejects(() => main(["nope"], {}, () => {}), /usage/);
  await assert.rejects(() => main(["local"], {}, () => {}), /control URL/);
  await assert.rejects(() => main(["record"], {}, () => {}), /admission/);
});

// ---- admission registry ---------------------------------------------------------------------------

test("admission: rulesize has exactly the reviewed task and cap", () => {
  assert.deepEqual(TASK_BY_MODE.rulesize, { taskId: "FS-WRITE-LIMITS-SANDBOX", limitUsd: 10 });
  assert.equal(taskIdForMode("rulesize"), "FS-WRITE-LIMITS-SANDBOX");
});

// ---- local half ------------------------------------------------------------------------------------

test("local: loopback only, one PUT per rung and a final reset", async () => {
  assert.throws(() => rulesUrlFor("http://example.com/v1/"), /loopback/);
  assert.throws(() => rulesUrlFor("https://127.0.0.1:1/v1/"), /loopback/);
  assert.equal(rulesUrlFor("http://127.0.0.1:9/v1/"), "http://127.0.0.1:9/v1/rules");
  assert.equal(rulesUrlFor("http://127.0.0.1:9/v1"), "http://127.0.0.1:9/v1/rules");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([init.method, url, init.headers.authorization]);
    if (init.method === "PUT" && JSON.parse(init.body).source.length > 2000)
      return json(400, { error: `rules do not parse ${FAKE_NUMBER}` });
    return json(200, { loaded: init.method === "PUT" });
  };
  const result = await runLocal({
    fetchImpl,
    controlUrl: "http://127.0.0.1:9/v1/",
    token: "local-token",
    rungs: corpus.rungs.slice(0, 2).concat(corpus.rungs.slice(-1)),
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows.at(-1).accepted, false);
  assert.doesNotMatch(result.rows.at(-1).message, /\d{12}/);
  assert.equal(calls.at(-1)[0], "DELETE");
  assert.ok(
    calls.every(
      ([, url, auth]) => url === "http://127.0.0.1:9/v1/rules" && auth === "Bearer local-token",
    ),
  );
  assert.equal(result.resetStatus, 200);
});
