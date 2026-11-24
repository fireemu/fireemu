import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  CANDIDATES,
  isEmptyTemplate,
  names,
  normalise,
  summarise,
} from "./remote-config-observe/plan.mjs";
import { Functions, logRows, sourceArchive } from "./remote-config-observe/functions.mjs";
import { Transport, Unknown } from "./remote-config-observe/transport.mjs";
import {
  LOCAL_TIMING,
  main,
  observe,
  productionAllow,
  templateUrls,
} from "./remote-config-observe/record.mjs";

// Guard: no test reaches the network. Every transport below gets an injected fetch.
globalThis.fetch = () => {
  throw new Error("network access in a test");
};

const PROJECT = "fireemu-oracle-query";
const NUMBER = "123456789012";
const RUN = "2611240000abc";
const N = names(RUN);
const scratch = () => mkdtempSync(join(tmpdir(), "rc-observe-"));
const journal = (out) =>
  readFileSync(join(out, "journal.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

function reply(status, body, headers = {}) {
  const bytes =
    body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const h = new Map(
    Object.entries({ "content-type": "application/json; charset=UTF-8", ...headers }),
  );
  return {
    status,
    headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => bytes,
  };
}

// ---- a fake Remote Config namespace pair, in the recorded shapes (2026-11-21) ----
function remoteConfigWorld({ client = 27, server = 6, faults = {} } = {}) {
  const ns = {
    client: { version: client, history: [], template: {} },
    server: { version: server, history: [], template: {} },
  };
  let time = 0;
  const user = { email: "owner@example.com" };
  const tag = (n) => `etag-${NUMBER}-${n}`;
  const meta = (n, type, extra = {}) => ({
    versionNumber: String(n),
    updateTime: `2026-11-24T00:00:${String(time++).padStart(2, "0")}.123456Z`,
    updateUser: user,
    updateOrigin: "REST_API",
    updateType: type,
    ...extra,
  });
  for (const n of Object.values(ns))
    n.history.push({ ...meta(n.version, "INCREMENTAL_UPDATE"), template: {} });
  const world = {
    ns,
    requests: [],
    handle(url, init) {
      const path = url.pathname;
      const which = path.includes("firebase-server") ? ns.server : ns.client;
      const name = path.includes("firebase-server") ? "server" : "client";
      const key = `${init.method} ${path.split("/").at(-1)}`;
      world.requests.push(key);
      const fault = faults[world.requests.length];
      if (fault) return fault(world, which);
      if (path.endsWith("serverRemoteConfig")) {
        if (!which.history.length) return reply(404, { error: { status: "NOT_FOUND" } });
        return reply(
          200,
          {
            conditions: (which.template.conditions ?? []).map((c) => ({
              name: c.name,
              condition: { orCondition: {} },
            })),
            parameters: {},
            parameterGroups: which.template.parameterGroups ?? {},
            version: { versionNumber: String(which.version), isLegacy: false },
          },
          { etag: tag(which.version) },
        );
      }
      if (path.endsWith(":listVersions"))
        return reply(200, {
          versions: which.history
            .slice()
            .reverse()
            .map(({ template: _template, ...v }) => ({
              ...v,
              updateUser: { ...user, name: "Owner" },
            })),
        });
      const current = () => ({
        ...which.template,
        version:
          which.history.at(-1) && (({ template: _template, ...v }) => v)(which.history.at(-1)),
      });
      if (init.method === "GET") return reply(200, current(), { etag: tag(which.version) });
      const body = JSON.parse(init.body);
      if (init.method === "POST" && path.endsWith(":rollback")) {
        const source = which.history.find((v) => v.versionNumber === body.versionNumber);
        if (!source) return reply(404, { error: { status: "NOT_FOUND" } });
        which.version += 1;
        which.template = structuredClone(source.template);
        which.history.push({
          ...meta(which.version, "ROLLBACK", { rollbackSource: body.versionNumber }),
          template: which.template,
        });
        world.publish?.(name, which.history.at(-1));
        return reply(200, current(), { etag: tag(which.version) });
      }
      const match = init.headers["if-match"];
      if (!match) return reply(400, { error: { status: "FAILED_PRECONDITION" } });
      if (match !== "*" && match !== tag(which.version))
        return reply(412, { error: { status: "FAILED_PRECONDITION" } });
      if (!body || typeof body !== "object")
        return reply(400, { error: { status: "INVALID_ARGUMENT" } });
      if (url.searchParams.get("validateOnly") === "true") {
        const bad = (body.conditions ?? []).some((c) => /notContains|!\(/.test(c.expression));
        return bad
          ? reply(400, { error: { status: "INVALID_ARGUMENT", message: "bad expression" } })
          : reply(200, { ...body, version: {} }, { etag: `etag-${NUMBER}-0` });
      }
      which.version += 1;
      const { version, ...template } = body;
      which.template = template;
      which.history.push({
        ...meta(
          which.version,
          match === "*" ? "FORCED_UPDATE" : "INCREMENTAL_UPDATE",
          version?.description ? { description: version.description } : {},
        ),
        template,
      });
      world.publish?.(name, which.history.at(-1));
      return reply(200, current(), { etag: tag(which.version) });
    },
  };
  return world;
}

// ---- a fake Cloud Functions / Logging world, in the recorded shapes ----
function cloudWorld({ rc, serverEvents = false, faults = {}, never = new Set() } = {}) {
  const fns = new Map();
  const ops = new Map();
  const entries = [];
  let opSeq = 0;
  const loc = `projects/${PROJECT}/locations/us-central1`;
  const world = { fns, entries, requests: [], deletes: 0 };
  const op = (generation, done, extra = {}) => {
    const name =
      generation === 1
        ? `operations/op${++opSeq}`
        : `projects/${NUMBER}/locations/us-central1/operations/op${++opSeq}`;
    ops.set(name, { name, done, ...extra });
    return name;
  };
  rc.publish = (namespace, version) => {
    if (namespace === "server" && !serverEvents) return;
    const { template: _template, ...data } = version;
    for (const fn of fns.values()) {
      if (fn.status !== "ACTIVE") continue;
      const row =
        fn.generation === 1
          ? {
              fireemuRcObserve: fn.run,
              generation: 1,
              receivedAt: "t",
              args: [
                data,
                {
                  eventId: `e${data.versionNumber}`,
                  eventType: "google.firebase.remoteconfig.update",
                  resource: {
                    service: "firebaseremoteconfig.googleapis.com",
                    name: `projects/${PROJECT}`,
                  },
                  timestamp: data.updateTime,
                },
              ],
            }
          : {
              fireemuRcObserve: fn.run,
              generation: 2,
              receivedAt: "t",
              args: [
                {
                  id: `x${data.versionNumber}`,
                  project: NUMBER,
                  source: `//firebaseremoteconfig.googleapis.com/projects/${PROJECT}`,
                  specversion: "1.0",
                  time: data.updateTime,
                  type: "google.firebase.remoteconfig.remoteConfig.v1.updated",
                  data: {
                    "@type":
                      "type.googleapis.com/google.events.firebase.remoteconfig.v1.RemoteConfigEventData",
                    rollbackSource: "0",
                    ...data,
                  },
                },
              ],
            };
      entries.push(
        fn.generation === 1
          ? { textPayload: JSON.stringify(row), timestamp: "t", insertId: `i${entries.length}` }
          : { jsonPayload: row, timestamp: "t", insertId: `i${entries.length}` },
      );
    }
  };
  world.handle = (url, init) => {
    const key = `${init.method} ${url.host} ${url.pathname}`;
    world.requests.push(key);
    const fault = faults[key]?.shift?.();
    if (fault) return fault(world);
    const p = url.pathname;
    if (url.host === "serviceusage.googleapis.com")
      return reply(200, {
        services: url.searchParams
          .getAll("names")
          .map((n) => ({ name: n, config: { name: n.split("/").at(-1) }, state: "ENABLED" })),
      });
    if (url.host === "artifactregistry.googleapis.com")
      return reply(200, {
        name: "gcf-artifacts",
        cleanupPolicies: { "firebase-functions-cleanup": {} },
      });
    if (url.host === "cloudresourcemanager.googleapis.com")
      return reply(200, {
        bindings: [{ role: "roles/owner", members: ["user:owner@example.com"] }],
        etag: "BwX",
      });
    if (url.host === "logging.googleapis.com") return reply(200, { entries });
    if (url.host === "eventarc.googleapis.com" || url.host === "run.googleapis.com")
      return reply(404, { error: { status: "NOT_FOUND" } });
    if (url.host === "storage.googleapis.com") {
      if (init.method === "PUT") return reply(200, "", { "content-type": "text/plain" });
      if (init.method === "DELETE") {
        world.sourceGone = true;
        return reply(204);
      }
      return world.sourceGone
        ? reply(404, { error: { code: 404 } })
        : reply(200, { generation: "17" });
    }
    const m = /^\/v([12])\/(.*)$/.exec(p);
    const generation = Number(m[1]);
    const rest = m[2];
    if (rest.endsWith("functions:generateUploadUrl"))
      return generation === 1
        ? reply(200, {
            uploadUrl:
              "https://storage.googleapis.com/gcf-upload-us-central1-abc/src.zip?GoogleAccessId=x&Signature=y",
          })
        : reply(200, {
            uploadUrl: `https://storage.googleapis.com/gcf-v2-uploads-${NUMBER}.us-central1.cloudfunctions.appspot.com/src.zip?X-Goog-Signature=y`,
            storageSource: {
              bucket: `gcf-v2-uploads-${NUMBER}.us-central1.cloudfunctions.appspot.com`,
              object: "src.zip",
            },
          });
    if (ops.has(rest)) {
      const o = ops.get(rest);
      if (never.has(o.kind)) return reply(200, { name: o.name, done: false });
      return reply(200, { name: o.name, done: true, ...(o.error ? { error: o.error } : {}) });
    }
    if (rest === `projects/${PROJECT}/locations/-/functions`)
      return reply(200, {
        functions: [...fns.values()]
          .filter((f) => f.status === "ACTIVE")
          .map((f) => ({ name: f.name }))
          .concat([{ name: `${loc}/functions/existing` }]),
      });
    if (init.method === "POST" && rest === `${loc}/functions`) {
      const body = JSON.parse(init.body);
      const required =
        generation === 1
          ? body.name &&
            body.runtime &&
            body.entryPoint &&
            body.sourceUploadUrl &&
            body.eventTrigger?.eventType &&
            body.eventTrigger?.resource
          : body.name &&
            body.buildConfig?.runtime &&
            body.buildConfig?.entryPoint &&
            body.buildConfig?.source?.storageSource?.bucket &&
            body.eventTrigger?.eventType;
      if (
        !required ||
        (generation === 2 && url.searchParams.get("functionId") !== body.name.split("/").at(-1))
      )
        return reply(400, { error: { status: "INVALID_ARGUMENT" } });
      fns.set(body.name, {
        name: body.name,
        generation,
        status: "ACTIVE",
        labels: body.labels,
        run: (body.environmentVariables ?? body.serviceConfig.environmentVariables)
          .FIREEMU_RC_OBSERVE_RUN,
      });
      const n = op(generation, false);
      ops.get(n).kind = `create${generation}`;
      return reply(200, { name: n });
    }
    const name = rest;
    const fn = fns.get(name);
    if (init.method === "DELETE") {
      world.deletes += 1;
      if (!fn) return reply(404, { error: { status: "NOT_FOUND" } });
      fns.delete(name);
      const n = op(generation, false);
      ops.get(n).kind = `delete${generation}`;
      return reply(200, { name: n });
    }
    if (!fn) return reply(404, { error: { status: "NOT_FOUND" } });
    return reply(200, {
      name,
      [generation === 1 ? "status" : "state"]: fn.status,
      labels: fn.labels,
      ...(generation === 2
        ? {
            eventTrigger: { trigger: `projects/${PROJECT}/locations/global/triggers/t1` },
            serviceConfig: { service: `projects/${PROJECT}/locations/us-central1/services/s1` },
          }
        : {}),
    });
  };
  return world;
}

function productionContext({
  rc = remoteConfigWorld(),
  cloud,
  out = scratch(),
  maxRequests = 252,
} = {}) {
  cloud ??= cloudWorld({ rc });
  const fetchImpl = async (url, init) => {
    if (url.host === "firebaseremoteconfig.googleapis.com") return rc.handle(url, init);
    return cloud.handle(url, init);
  };
  const transport = new Transport({
    out,
    allow: productionAllow({ project: PROJECT, number: NUMBER, names: N }),
    token: () => "tok",
    maxRequests,
    timeoutMs: 1000,
    fetchImpl,
    userProject: PROJECT,
  });
  const functions = new Functions({
    transport,
    project: PROJECT,
    number: NUMBER,
    names: N,
    runId: RUN,
    wait: async () => {},
  });
  const services = new URL(
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services:batchGet`,
  );
  for (const s of [
    "firebaseremoteconfig",
    "cloudfunctions",
    "cloudbuild",
    "artifactregistry",
    "run",
    "eventarc",
    "logging",
  ])
    services.searchParams.append("names", `projects/${PROJECT}/services/${s}.googleapis.com`);
  return {
    rc,
    cloud,
    out,
    transport,
    ctx: {
      transport,
      urls: templateUrls("https://firebaseremoteconfig.googleapis.com/v1/", PROJECT),
      runId: RUN,
      timing: { ...LOCAL_TIMING, windowReads: 2 },
      wait: async () => {},
      events: async (caseId) => (await functions.logs(caseId, "2026-11-24T00:00:00Z")).rows,
      production: {
        functions,
        google: {
          services: services.href,
          repository: `https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/repositories/gcf-artifacts`,
          iam: `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,
          functions: `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/-/functions`,
        },
      },
    },
  };
}

test("allow list: only the sandbox, the run's own functions and the upload bucket", () => {
  const allow = productionAllow({ project: PROJECT, number: NUMBER, names: N });
  const ok = (u, m = "GET", o) => allow(new URL(u), m, o);
  const fn = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/functions/`;
  assert.equal(
    ok(`https://firebaseremoteconfig.googleapis.com/v1/projects/${PROJECT}/remoteConfig`, "PUT"),
    true,
  );
  assert.equal(
    ok(
      "https://firebaseremoteconfig.googleapis.com/v1/projects/fireemu-oracle-sbx/remoteConfig",
      "PUT",
    ),
    false,
  );
  assert.equal(
    ok(
      "https://firebaseremoteconfig.googleapis.com/v1/projects/fireemu-oracle-query-x/remoteConfig",
    ),
    false,
  );
  assert.equal(
    ok(`https://firebaseremoteconfig.googleapis.com/v1/projects/${PROJECT}/remoteConfig`, "DELETE"),
    false,
  );
  assert.equal(ok(fn + N.gen2, "DELETE"), true);
  assert.equal(ok(fn + "existing", "DELETE"), false);
  assert.equal(ok(fn.replace("/v2/", "/v1/") + N.gen1, "DELETE"), true);
  assert.equal(ok(fn.replace("us-central1", "us-east1") + N.gen2, "DELETE"), false);
  assert.equal(
    ok(
      `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/functions`,
      "POST",
    ),
    true,
  );
  assert.equal(
    ok(
      `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/functions/x:setIamPolicy`,
      "POST",
    ),
    false,
  );
  assert.equal(
    ok(
      `https://storage.googleapis.com/storage/v1/b/gcf-v2-uploads-${NUMBER}.us-central1.cloudfunctions.appspot.com/o/src.zip`,
      "DELETE",
    ),
    true,
  );
  assert.equal(
    ok(`https://storage.googleapis.com/storage/v1/b/other-bucket/o/src.zip`, "DELETE"),
    false,
  );
  assert.equal(
    ok("https://storage.googleapis.com/x/y.zip?Signature=s", "PUT", { signed: true }),
    true,
  );
  assert.equal(ok("https://evil.example/x.zip", "PUT", { signed: true }), false);
  assert.equal(ok("http://logging.googleapis.com/v2/entries:list", "POST"), false);
  assert.equal(ok("https://logging.googleapis.com/v2/entries:write", "POST"), false);
  assert.equal(
    ok(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:setIamPolicy`, "POST"),
    false,
  );
  assert.equal(
    ok(
      `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/run.googleapis.com:enable`,
      "POST",
    ),
    false,
  );
});

test("transport: unknown answers are journaled unknown, never settled", async () => {
  const cases = [
    [() => reply(503, { error: {} }), "status 503"],
    [() => reply(302, ""), "status 302"],
    [() => reply(199, ""), "status 199"],
    [
      () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      "transport: TimeoutError",
    ],
    [() => reply(200, "<html>"), "unreadable body"],
  ];
  for (const [answer, reason] of cases) {
    const out = scratch();
    const t = new Transport({
      out,
      allow: () => true,
      token: () => "secret-token",
      maxRequests: 5,
      timeoutMs: 10,
      fetchImpl: async () => answer(),
    });
    await assert.rejects(
      t.send("case-a", "https://firebaseremoteconfig.googleapis.com/v1/x"),
      Unknown,
    );
    const rows = journal(out);
    assert.deepEqual(
      rows.map((r) => r.phase).filter((p) => p !== "response-persisted"),
      ["before-send", "unknown"],
      reason,
    );
    assert.equal(rows.at(-1).reason, reason);
    assert.deepEqual(t.unknown, ["case-a"]);
    assert.equal(readFileSync(join(out, "journal.jsonl"), "utf8").includes("secret-token"), false);
    rmSync(out, { recursive: true });
  }
});

test("transport: complete 4xx answers are answers; cap, allow list and signed queries", async () => {
  const out = scratch();
  const t = new Transport({
    out,
    allow: (u) => u.host !== "deny.example",
    token: () => "tok",
    maxRequests: 2,
    timeoutMs: 10,
    fetchImpl: async () => reply(429, { error: { status: "RESOURCE_EXHAUSTED" } }),
  });
  const r = await t.send("a", "https://ok.example/p");
  assert.equal(r.status, 429);
  await assert.rejects(t.send("b", "https://deny.example/p"), /not permitted/);
  await t.send("c", "https://ok.example/u?Signature=abc", {
    method: "PUT",
    raw: Buffer.from("z"),
    signed: true,
  });
  await assert.rejects(t.send("d", "https://ok.example/p"), /cap/);
  const text = readFileSync(join(out, "journal.jsonl"), "utf8");
  assert.equal(text.includes("Signature=abc"), false);
  assert.equal(journal(out).filter((x) => x.phase === "before-send").length, 2);
});

test("production run against the recorded shapes: complete, at baseline, items extracted", async () => {
  const { ctx, rc, cloud, transport } = productionContext();
  const { result } = await observe(ctx);
  assert.equal(result.stopped, null, JSON.stringify(result.open));
  assert.equal(result.complete, true);
  assert.equal(result.sandboxAtBaseline, true);
  assert.ok(transport.count <= 252);
  assert.equal(cloud.fns.size, 0);
  assert.equal(
    isEmptyTemplate(rc.ns.client.template) && isEmptyTemplate(rc.ns.server.template),
    true,
  );
  assert.deepEqual(
    result.versions.map((v) => `${v.namespace}:${v.step}:${v.versionNumber}`),
    [
      "client:c0:28",
      "server:s1:7",
      "server:s4:8",
      "server:s5:9",
      "client:c1:29",
      "client:c2:30",
      "client:c3:31",
      "client:c4:32",
    ],
  );
  const s = result.summary;
  for (const g of ["1", "2"]) {
    assert.deepEqual(s.generations[g].clientSteps, ["c0", "c1", "c2", "c3", "c4"]);
    assert.equal(s.generations[g].serverDelivery, "none-within-window");
    assert.equal(s.generations[g].updateUserEqualsHistory, true);
    assert.deepEqual(s.generations[g].updateUserKeys, ['["email"]']);
  }
  assert.deepEqual(s.generations["2"].projectValues, [NUMBER]);
  assert.deepEqual(s.generations["2"].descriptionWithout, [{ present: false, value: undefined }]);
  // The fake refuses notContains and negation, as an example of a refused validation.
  assert.equal(s.validations.filter((v) => v.status === 400).length, 2);
  assert.equal(s.dataPlane.conditions.length, CANDIDATES.length - 2);
  assert.deepEqual(s.wildcard, { status: 200, error: null, message: null });
  // Deploys went one at a time: Gen1 created and read ACTIVE before the Gen2 upload URL.
  const order = cloud.requests.filter(
    (r) => /functions(:generateUploadUrl)?$/.test(r) && r.startsWith("POST"),
  );
  assert.deepEqual(
    order.map((r) => r.split("/")[1]),
    ["v1", "v1", "v2", "v2"],
  );
});

test("server events are attributed only with the control delivered and disjoint numbers", async () => {
  const rc = remoteConfigWorld();
  const { ctx } = productionContext({ rc, cloud: cloudWorld({ rc, serverEvents: true }) });
  const { result } = await observe(ctx);
  assert.deepEqual(result.summary.generations["1"].serverSteps, ["s1", "s4", "s5"]);
  assert.equal(result.summary.generations["1"].serverDelivery, "delivered");
  const rc2 = remoteConfigWorld({ client: 6, server: 6 });
  const { ctx: ctx2 } = productionContext({
    rc: rc2,
    cloud: cloudWorld({ rc: rc2, serverEvents: true }),
  });
  const { result: overlapping } = await observe(ctx2);
  assert.equal(overlapping.summary.versionRangesOverlap, true);
  assert.equal(overlapping.summary.generations["1"].serverDelivery, "not-evidence");
});

test("an unknown create that later reads 404 stays open", async () => {
  const rc = remoteConfigWorld();
  const key = `POST cloudfunctions.googleapis.com /v2/projects/${PROJECT}/locations/us-central1/functions`;
  const cloud = cloudWorld({ rc, faults: { [key]: [() => reply(503, {})] } });
  const { ctx } = productionContext({ rc, cloud });
  const { result } = await observe(ctx);
  assert.equal(result.complete, false);
  assert.equal(result.sandboxAtBaseline, false);
  assert.ok(
    result.open.some((o) => o.startsWith("gen2: absent before")),
    JSON.stringify(result.open),
  );
  assert.ok(result.open.includes("gen2: create not settled"));
  assert.ok(!cloud.requests.some((r) => r.startsWith("PUT") && r.includes("firebaseremoteconfig")));
});

test("a confirmed create that reads 404 before its own DELETE stays open", async () => {
  const rc = remoteConfigWorld();
  const cloud = cloudWorld({ rc });
  const { ctx } = productionContext({ rc, cloud });
  const original = ctx.production.functions.remove.bind(ctx.production.functions);
  ctx.production.functions.remove = async (generation) => {
    if (generation === 1) cloud.fns.clear();
    return original(generation);
  };
  const { result } = await observe(ctx);
  assert.ok(result.open.some((o) => o.startsWith("gen1: absent before")));
  assert.equal(result.sandboxAtBaseline, false);
});

test("an unknown DELETE is never re-sent and stays open; an undone delete operation stays open", async () => {
  const rc = remoteConfigWorld();
  const key = `DELETE cloudfunctions.googleapis.com /v1/projects/${PROJECT}/locations/us-central1/functions/${N.gen1}`;
  const cloud = cloudWorld({
    rc,
    faults: {
      [key]: [
        () => {
          throw new Error("reset");
        },
      ],
    },
  });
  const { ctx } = productionContext({ rc, cloud });
  const { result } = await observe(ctx);
  assert.equal(cloud.requests.filter((r) => r === key).length, 1);
  assert.ok(result.open.some((o) => o.includes("gen1: DELETE unknown")));
  const rc2 = remoteConfigWorld();
  const cloud2 = cloudWorld({ rc: rc2, never: new Set(["delete2"]) });
  const { ctx: ctx2 } = productionContext({ rc: rc2, cloud: cloud2 });
  const { result: r2 } = await observe(ctx2);
  assert.ok(r2.open.includes("gen2: delete operation not done without error"));
  assert.equal(r2.complete, false);
});

test("an unknown publish stops the program; restoration reads and rolls back only what it sees", async () => {
  // Request 28 of the Remote Config world is s1-publish (2 reads, c0, 24 validations, then s1); it
  // is applied but answered 503.
  const applied = (world, which) => {
    which.version += 1;
    which.template = { parameters: { x: {} } };
    which.history.push({
      versionNumber: String(which.version),
      updateTime: "u",
      template: which.template,
    });
    return reply(503, {});
  };
  const rc = remoteConfigWorld({ faults: { 28: applied } });
  const { ctx } = productionContext({ rc });
  const { result } = await observe(ctx);
  assert.match(result.stopped, /s1-publish: unknown/);
  assert.ok(result.open.some((o) => o.startsWith("s1-publish: unknown server write")));
  assert.ok(rc.requests.includes("POST remoteConfig:rollback"));
  assert.equal(isEmptyTemplate(rc.ns.server.template), true);
  assert.equal(result.sandboxAtBaseline, false);
  // An unknown publish that did not apply: the read shows the baseline, nothing is rolled back,
  // and the answer stays open (an absence never settles it).
  const rc2 = remoteConfigWorld({ faults: { 28: () => reply(500, {}) } });
  const { ctx: ctx2 } = productionContext({ rc: rc2 });
  const { result: r2 } = await observe(ctx2);
  assert.equal(rc2.requests.filter((r) => r === "POST remoteConfig:rollback").length, 1); // c0's restore only
  assert.ok(r2.open.some((o) => o.startsWith("s1-publish")));
});

test("a refused wildcard is recorded and the run continues; an unknown validation is recorded", async () => {
  const rc = remoteConfigWorld({
    faults: {
      31: () => reply(412, { error: { status: "FAILED_PRECONDITION", message: "m" } }),
      5: () => reply(502, {}),
    },
  });
  const { ctx } = productionContext({ rc });
  const { result } = await observe(ctx);
  assert.deepEqual(result.summary.wildcard, {
    status: 412,
    error: "FAILED_PRECONDITION",
    message: "m",
  });
  assert.equal(
    result.versions.some((v) => v.step === "s4"),
    false,
  );
  assert.ok(result.versions.some((v) => v.step === "c4"));
  assert.equal(result.summary.validations.filter((v) => v.status === "unknown").length, 1);
  assert.deepEqual(result.unknown, ["s-validate-01"]);
  assert.equal(result.complete, false);
  assert.equal(result.sandboxAtBaseline, true);
});

test("a run stops before any write when the baseline is not met", async () => {
  for (const change of [
    (rc) => {
      rc.ns.client.template = { parameters: { a: {} } };
    },
    (rc) => {
      rc.ns.server.history = [];
    },
  ]) {
    const rc = remoteConfigWorld();
    change(rc);
    const { ctx, cloud } = productionContext({ rc });
    const { result } = await observe(ctx);
    assert.ok(result.stopped);
    assert.equal(rc.requests.filter((r) => !r.startsWith("GET")).length, 0);
    assert.equal(cloud.requests.filter((r) => r.startsWith("POST cloudfunctions")).length, 0);
  }
});

test("request cap: the cap stops a run and cleanup still runs inside it", async () => {
  const { ctx } = productionContext({ maxRequests: 60 });
  const { result } = await observe(ctx);
  assert.ok(result.requests <= 60);
  assert.equal(result.complete, false);
});

test("summarise: arrival order, duplicates and the control (seeded random property)", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let round = 0; round < 300; round += 1) {
    const steps = ["c0", "c1", "c2", "c3", "c4"];
    const versions = steps.map((step, i) => ({
      namespace: "client",
      step,
      versionNumber: String(28 + i),
      updateTime: `t${i}`,
    }));
    const delivered = steps
      .filter((s) => s !== "c0" || random() < 0.7)
      .map((s) => versions.find((v) => v.step === s));
    const copies = delivered.flatMap((v) => (random() < 0.2 ? [v, v] : [v]));
    const shuffled = copies
      .map((v) => [random(), v])
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);
    const events = shuffled.map((v, i) =>
      normalise(
        {
          generation: 2,
          args: [
            {
              id: `id${v.versionNumber}`,
              data: { versionNumber: v.versionNumber, updateTime: v.updateTime },
            },
          ],
        },
        i,
      ),
    );
    const s = summarise({
      events,
      versions,
      history: {},
      dataPlane: null,
      wildcard: null,
      validations: [],
      open: [],
    }).generations["2"];
    const numbers = shuffled.map((v) => Number(v.versionNumber));
    assert.equal(
      s.inPublicationOrder,
      numbers.every((n, i) => i === 0 || numbers[i - 1] <= n),
    );
    assert.equal(
      s.duplicates.length,
      new Set(copies.filter((v, i) => copies.indexOf(v) !== i)).size,
    );
    assert.equal(
      s.serverDelivery,
      delivered.some((v) => v.step === "c0") ? "none-within-window" : "not-evidence",
    );
    assert.equal(s.unmatched + s.ambiguous, 0);
  }
});

test("logRows reads Gen1 text and Gen2 JSON payloads of this run only", () => {
  const row = { fireemuRcObserve: RUN, generation: 1, args: [] };
  const rows = logRows(
    [
      { textPayload: JSON.stringify(row), timestamp: "a", insertId: "1" },
      { jsonPayload: { ...row, generation: 2 }, timestamp: "b", insertId: "2" },
      { jsonPayload: { ...row, fireemuRcObserve: "other" } },
      { textPayload: "not json" },
    ],
    RUN,
  );
  assert.deepEqual(
    rows.map((r) => [r.generation, r.insertId]),
    [
      [1, "1"],
      [2, "2"],
    ],
  );
});

test("normalise: Gen1 (data, context), Gen2 CloudEvent and Gen2 (data, context)", () => {
  const data = { versionNumber: "5", updateTime: "t" };
  assert.equal(normalise({ generation: 1, args: [data, { eventId: "a" }] }, 0).eventId, "a");
  assert.equal(normalise({ generation: 2, args: [{ id: "b", data }] }, 0).versionNumber, "5");
  assert.equal(normalise({ generation: 2, args: [data, { id: "c" }] }, 0).eventId, "c");
  assert.equal(normalise({ generation: 2, data, context: { id: "d" } }, 0).eventId, "d");
});

test("the source archive is a stored zip of package.json and the handler", () => {
  const zip = sourceArchive();
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  const files = {};
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString();
    files[name] = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size).toString();
    at += 30 + nameLength + size;
  }
  assert.deepEqual(Object.keys(files), ["package.json", "index.js"]);
  assert.equal(
    JSON.parse(files["package.json"]).dependencies["@google-cloud/functions-framework"],
    "3.5.0",
  );
  assert.match(files["index.js"], /exports\.rcObserveV2/);
  assert.equal(typeof inflateRawSync, "function");
});

test("main refuses production without the send flag or with a credential file, before any request", async () => {
  const out = join(scratch(), "run");
  await assert.rejects(main(["--target", "production", "--out", out], {}), /--send-production/);
  await assert.rejects(
    main(["--target", "production", "--send-production", "--out", out], {
      FIREEMU_SANDBOX_PROJECT_NUMBER: NUMBER,
      GOOGLE_APPLICATION_CREDENTIALS: "/x",
    }),
    /must be unset/,
  );
  await assert.rejects(
    main(["--target", "production", "--send-production", "--out", out], {}),
    /PROJECT_NUMBER/,
  );
  await assert.rejects(
    main(["--target", "local", "--send-production", "--out", out], {}),
    /production target only/,
  );
  // No test in this file passes the send flag to a run that reaches the network: production runs
  // above use observe() with an injected fetch.
});

test("a create whose operation never reads done stays open and no publish is sent", async () => {
  const rc = remoteConfigWorld();
  const cloud = cloudWorld({ rc, never: new Set(["create1"]) });
  const { ctx } = productionContext({ rc, cloud });
  const { result } = await observe(ctx);
  assert.ok(result.open.includes("gen1: create not settled"), JSON.stringify(result.open));
  assert.equal(rc.requests.filter((r) => !r.startsWith("GET")).length, 0);
  assert.equal(cloud.requests.filter((r) => r.includes("/v2/") && r.startsWith("POST")).length, 0);
});

test("a failed Gen1 create stops the run before the Gen2 deploy and any publish", async () => {
  const rc = remoteConfigWorld();
  const key = `POST cloudfunctions.googleapis.com /v1/projects/${PROJECT}/locations/us-central1/functions`;
  const cloud = cloudWorld({
    rc,
    faults: { [key]: [() => reply(400, { error: { status: "INVALID_ARGUMENT" } })] },
  });
  const { ctx } = productionContext({ rc, cloud });
  const { result } = await observe(ctx);
  assert.match(result.stopped, /gen1 deploy did not complete/);
  assert.equal(rc.requests.filter((r) => !r.startsWith("GET")).length, 0);
  assert.equal(cloud.requests.filter((r) => r.includes("/v2/") && r.startsWith("POST")).length, 0);
});

test("an upload bucket outside the sandbox stops before the upload", async () => {
  const rc = remoteConfigWorld();
  const key = `POST cloudfunctions.googleapis.com /v2/projects/${PROJECT}/locations/us-central1/functions:generateUploadUrl`;
  const other = {
    uploadUrl:
      "https://storage.googleapis.com/gcf-v2-uploads-999999999999.us-central1.cloudfunctions.appspot.com/src.zip?X-Goog-Signature=y",
    storageSource: {
      bucket: "gcf-v2-uploads-999999999999.us-central1.cloudfunctions.appspot.com",
      object: "src.zip",
    },
  };
  const cloud = cloudWorld({ rc, faults: { [key]: [() => reply(200, other)] } });
  const { ctx } = productionContext({ rc, cloud });
  const { result } = await observe(ctx);
  assert.match(result.stopped, /outside the sandbox/);
  assert.equal(
    cloud.requests.filter((r) => r.startsWith("PUT") && r.includes("gcf-v2-uploads")).length,
    0,
  );
});

test("cleanup never deletes a function without the run label", async () => {
  const rc = remoteConfigWorld();
  const cloud = cloudWorld({ rc });
  const { ctx } = productionContext({ rc, cloud });
  const original = ctx.production.functions.remove.bind(ctx.production.functions);
  ctx.production.functions.remove = async (generation) => {
    for (const fn of cloud.fns.values()) fn.labels = { "fireemu-rc-observe": "someone-else" };
    return original(generation);
  };
  const { result } = await observe(ctx);
  assert.equal(cloud.deletes, 0);
  assert.ok(result.open.some((o) => o.includes("unowned")));
});

test("an event of a version this run did not create is unmatched, even with the same number", () => {
  const versions = [{ namespace: "server", step: "s1", versionNumber: "7", updateTime: "t1" }];
  const events = [
    normalise(
      { generation: 1, args: [{ versionNumber: "7", updateTime: "t0" }, { eventId: "a" }] },
      0,
    ),
  ];
  const s = summarise({
    events,
    versions,
    history: {},
    dataPlane: null,
    wildcard: null,
    validations: [],
    open: [],
  });
  assert.equal(s.generations["1"].unmatched, 1);
  assert.deepEqual(s.generations["1"].serverSteps, []);
});

test("the A2 read-back reads both templates, both names, the list and IAM, and sends nothing else", async () => {
  const rc = remoteConfigWorld();
  const { ctx, cloud, transport } = productionContext({ rc });
  const { readBack } = await import("./remote-config-observe/record.mjs");
  const back = await readBack(ctx);
  assert.equal(back.atBaseline, true);
  assert.deepEqual(back.functions, { gen1: 404, gen2: 404 });
  assert.equal(transport.count, 6);
  assert.equal(
    [...rc.requests, ...cloud.requests].filter(
      (r) => !r.startsWith("GET") && !r.includes(":getIamPolicy"),
    ).length,
    0,
  );
  rc.ns.server.template = { parameters: { a: {} } };
  assert.equal((await readBack(productionContext({ rc }).ctx)).atBaseline, false);
});
