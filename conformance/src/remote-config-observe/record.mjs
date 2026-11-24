// Remote Config observation recorder (REMOTE-CONFIG parent, items unrecorded after
// work/remote-config-server). One run against one target:
//
//   node src/remote-config-observe/record.mjs --target local --base <control apiBaseUrl>
//     --project <id> --events-file <jsonl the local handlers append to> --out <new dir>
//   node src/remote-config-observe/record.mjs --target production --send-production --out <new dir>
//
// local reads FIREEMU_CONTROL_TOKEN; production reads FIREEMU_SANDBOX_PROJECT_NUMBER and takes the
// caller's ADC token from gcloud. Production is sent only with --send-production, which only the
// packet's launch script passes; no test passes it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CANDIDATES,
  PRODUCTION_PROJECT,
  REGION,
  candidateTemplate,
  clientTemplate,
  isEmptyTemplate,
  names as runNames,
  normalise,
  serverTemplate,
  summarise,
} from "./plan.mjs";
import { Functions, GCF, newGrants } from "./functions.mjs";
import { Transport, Unknown } from "./transport.mjs";

// Request cap of a production run: baseline 8, deploys 2 x 44 + 1 log read, server 24 + 6,
// client 6, history 2, window 10, cleanup 103 (Gen2 51, Gen1 43, source 3, IAM 1, list 3, two final
// template reads), restoration 4 (a rollback and a read per namespace). The run stops at the cap.
// An A2 read-back makes at most A2_MAX_REQUESTS.
export const MAX_REQUESTS = 252;
export const A2_MAX_REQUESTS = 11;
export const PRODUCTION_TIMING = {
  paceMs: 2000,
  readyMs: 120_000,
  windowReads: 10,
  windowMs: 30_000,
  timeoutMs: 30_000,
};
export const LOCAL_TIMING = {
  paceMs: 0,
  readyMs: 0,
  windowReads: 5,
  windowMs: 1000,
  timeoutMs: 10_000,
};
const RC_API = "https://firebaseremoteconfig.googleapis.com/v1/";
const SERVICES = [
  "firebaseremoteconfig.googleapis.com",
  "cloudfunctions.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "run.googleapis.com",
  "eventarc.googleapis.com",
  "logging.googleapis.com",
];

export function templateUrls(base, project) {
  const root = new URL(`projects/${project}/`, base);
  return {
    client: new URL("remoteConfig", root).href,
    server: new URL("namespaces/firebase-server/remoteConfig", root).href,
    dataPlane: new URL("namespaces/firebase-server/serverRemoteConfig", root).href,
  };
}

/**
 * The closed set of production requests: exactly the method, path and query pairs of packet
 * section 3, with the run's own function names (never crossed between generations), and the
 * provider-named resources the run learned (`grants`: the signed upload URLs it was issued, its Gen2
 * source object, the Gen2 trigger and service its own function names).
 */
export function productionAllow({ project, number, names, grants }) {
  const p = project;
  const loc = `/projects/${p}/locations/${REGION}`;
  const rc = `/v1/projects/${p}/`;
  const client = `${rc}remoteConfig`;
  const server = `${rc}namespaces/firebase-server/remoteConfig`;
  const fn1 = `/v1${loc}/functions/${names.gen1}`;
  const fn2 = `/v2${loc}/functions/${names.gen2}`;
  const exact = new Set([
    `GET ${client}`,
    `GET ${server}`,
    `PUT ${client}`,
    `PUT ${server}`,
    `PUT ${server}?validateOnly=true`,
    `POST ${client}:rollback`,
    `POST ${server}:rollback`,
    `GET ${client}:listVersions?pageSize=8`,
    `GET ${server}:listVersions?pageSize=8`,
    `GET ${rc}namespaces/firebase-server/serverRemoteConfig`,
    `POST /v1${loc}/functions:generateUploadUrl`,
    `POST /v2${loc}/functions:generateUploadUrl`,
    `POST /v1${loc}/functions`,
    `POST /v2${loc}/functions?functionId=${names.gen2}`,
    `GET ${fn1}`,
    `GET ${fn2}`,
    `DELETE ${fn1}`,
    `DELETE ${fn2}`,
    `GET /v2/projects/${p}/locations/-/functions?pageSize=100`,
    `POST /v2/entries:list`,
    `POST /v1/projects/${p}:getIamPolicy`,
    `GET /v1${loc}/repositories/gcf-artifacts`,
  ]);
  const host = {
    "firebaseremoteconfig.googleapis.com": (k) => k.includes(` ${rc}`),
    "cloudfunctions.googleapis.com": (k) => / \/v[12]\//.test(k),
    "logging.googleapis.com": (k) => k === "POST /v2/entries:list",
    "cloudresourcemanager.googleapis.com": (k) => k.endsWith(":getIamPolicy"),
    "artifactregistry.googleapis.com": (k) => k.includes("/repositories/"),
  };
  const services = `/v1/projects/${p}/services:batchGet`;
  const servicesQuery = `?${new URLSearchParams(SERVICES.map((s) => ["names", `projects/${p}/services/${s}`]))}`;
  return (url, method, { signed } = {}) => {
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    // A signed upload goes only to a URL this run was issued, byte for byte.
    if (signed) return method === "PUT" && grants.signed.has(url.href);
    const path = url.pathname;
    const key = `${method} ${path}${url.search}`;
    if (exact.has(key)) return host[url.host]?.(key) === true;
    switch (url.host) {
      case "cloudfunctions.googleapis.com":
        return (
          (method === "GET" &&
            (/^\/v1\/operations\/[A-Za-z0-9_.-]+$/.test(path) ||
              new RegExp(
                `^/v2/projects/(${p}|${number})/locations/${REGION}/operations/[A-Za-z0-9_-]+$`,
              ).test(path)) &&
            url.search === "") ||
          (method === "GET" &&
            path === `/v2/projects/${p}/locations/-/functions` &&
            /^\?pageSize=100&pageToken=[A-Za-z0-9%_.~-]+$/.test(url.search))
        );
      case "serviceusage.googleapis.com":
        return method === "GET" && path === services && url.search === servicesQuery;
      case "storage.googleapis.com": {
        const src = grants.source;
        if (!src) return false;
        const object = `/storage/v1/b/${src.bucket}/o/${encodeURIComponent(src.object)}`;
        return (
          path === object &&
          ((method === "GET" && url.search === "") ||
            (method === "DELETE" && /^\?ifGenerationMatch=[0-9]+$/.test(url.search)))
        );
      }
      case "eventarc.googleapis.com":
        return (
          method === "GET" &&
          url.search === "" &&
          path.startsWith("/v1/") &&
          grants.managed.has(path.slice(4)) &&
          path.includes("/triggers/")
        );
      case "run.googleapis.com":
        return (
          method === "GET" &&
          url.search === "" &&
          path.startsWith("/v2/") &&
          grants.managed.has(path.slice(4)) &&
          path.includes("/services/")
        );
      default:
        return false;
    }
  };
}

/** Local runs reach only the loopback control listener. */
export function localAllow(base) {
  const origin = new URL(base);
  return (url, method, { signed } = {}) =>
    !signed &&
    url.origin === origin.origin &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    ["GET", "PUT", "POST"].includes(method);
}

class Stop extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const canonicalBindings = (policy) =>
  JSON.stringify(
    (policy?.bindings ?? [])
      .map((b) => [b.role, [...(b.members ?? [])].sort(), b.condition ?? null])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );

/**
 * Runs the observation. `ctx`: {transport, urls, runId, timing, wait, events(caseId) -> rows,
 * production?: {project, functions, google: {services, repository, iam, functions}}}.
 */
export async function observe(ctx) {
  const { transport: t, urls, runId, timing, wait = sleep } = ctx;
  const prod = ctx.production ?? null;
  const result = {
    runId,
    target: prod ? "production" : "local",
    stopped: null,
    open: [],
    baseline: {},
  };
  const versions = [];
  const validations = [];
  const sent = { client: false, server: false };
  const rows = new Map();
  let base = {};
  let dataPlane = null;
  let wildcard = null;
  const history = {};
  let lastWrite = 0;

  const read = async (caseId, url) => {
    const r = await t.send(caseId, url);
    if (r.status !== 200 || !r.etag) throw new Error(`${caseId}: template read ${r.status}`);
    return r;
  };
  // A write in one namespace. An unknown answer stops the forward program; restoration below
  // reads the namespace and never treats an absence as settling it.
  const write = async (caseId, namespace, url, method, body, ifMatch, { creates = true } = {}) => {
    const gap = lastWrite + timing.paceMs - Date.now();
    if (gap > 0) await wait(gap);
    sent[namespace] = true;
    try {
      return await t.send(caseId, url, { method, body, ifMatch });
    } catch (error) {
      if (error instanceof Unknown && creates)
        result.open.push(`${caseId}: unknown ${namespace} write (A2 reads ${namespace})`);
      throw error;
    } finally {
      lastWrite = Date.now();
    }
  };
  const created = (namespace, step, r) => {
    if (r.status !== 200 || !r.json.version?.versionNumber)
      throw new Stop(`${step}: ${namespace} write answered ${r.status}`);
    const v = r.json.version;
    const row = {
      namespace,
      step,
      versionNumber: String(v.versionNumber),
      updateTime: v.updateTime ?? null,
      updateType: v.updateType ?? null,
      etag: r.etag,
    };
    versions.push(row);
    return row;
  };
  const logReads = [];
  // A truncated read is an unknown: the window's answer is then not evidence (ruling 1, S1).
  const collect = async (caseId) => {
    const read = await ctx.events(caseId);
    logReads.push({ case: caseId, rows: read.rows.length, truncated: read.truncated });
    for (const row of read.rows) rows.set(row.insertId ?? JSON.stringify(row), row);
  };

  try {
    // ---- A. baseline (read-only) ----
    const client0 = await read("a-client", urls.client);
    const server0 = await read("a-server", urls.server);
    base = {
      client: {
        version: client0.json.version?.versionNumber ?? null,
        empty: isEmptyTemplate(client0.json),
        etag: client0.etag,
      },
      server: {
        version: server0.json.version?.versionNumber ?? null,
        empty: isEmptyTemplate(server0.json),
        etag: server0.etag,
      },
    };
    result.baseline.before = base;
    if (!base.client.empty || !base.server.empty || !base.client.version || !base.server.version)
      throw new Stop("templates are not at the published empty baseline");
    if (prod) {
      const g = prod.google;
      const services = await t.send("a-services", g.services);
      const states = Object.fromEntries(
        (services.json.services ?? []).map((s) => [s.config?.name ?? s.name, s.state]),
      );
      result.baseline.services = states;
      if (services.status !== 200 || !SERVICES.every((s) => states[s] === "ENABLED"))
        throw new Stop("a required API is not ENABLED");
      const repo = await t.send("a-repository", g.repository);
      result.baseline.repository = {
        status: repo.status,
        cleanupPolicies: Object.keys(repo.json.cleanupPolicies ?? {}),
      };
      if (repo.status !== 200)
        throw new Stop("gcf-artifacts is missing (a deploy would create it)");
      // The accepted residue (the Gen2 build image) rests on this policy (ruling 1, S5).
      if (!result.baseline.repository.cleanupPolicies.includes("firebase-functions-cleanup"))
        throw new Stop("gcf-artifacts has no firebase-functions-cleanup policy");
      const iam = await t.send("a-iam", g.iam, { method: "POST", body: {} });
      if (iam.status !== 200) throw new Stop("project IAM unreadable");
      result.baseline.iamBefore = canonicalBindings(iam.json);
      result.baseline.functionsBefore = await listFunctions(t, g.functions, "a-functions");
      const own = [prod.functions.names.gen1, prod.functions.names.gen2];
      if (
        result.baseline.functionsBefore.some((n) => own.some((o) => n.endsWith(`/functions/${o}`)))
      )
        throw new Stop("a fresh function name already exists");

      // ---- B. deploy, one at a time ----
      for (const generation of [1, 2])
        if (!(await prod.functions.deploy(generation)))
          throw new Stop(`gen${generation} deploy did not complete`);
      await wait(timing.readyMs); // Gen2 trigger readiness (2026-11-21: events arrived after 100 s)
      await collect("b-logs-baseline");
      if (rows.size) throw new Stop("rows with this run's marker before any publish");
    }

    // ---- C0. control: one client publish before the server phase ----
    let clientTag = base.client.etag;
    const c0 = created(
      "client",
      "c0",
      await write(
        "c0-publish",
        "client",
        urls.client,
        "PUT",
        clientTemplate("c0", runId),
        clientTag,
      ),
    );
    clientTag = c0.etag;

    // ---- S. server namespace ----
    const accepted = [];
    for (const [i, candidate] of CANDIDATES.entries()) {
      const caseId = `s-validate-${String(i).padStart(2, "0")}`;
      let r;
      try {
        r = await write(
          caseId,
          "server",
          `${urls.server}?validateOnly=true`,
          "PUT",
          candidateTemplate(candidate),
          base.server.etag,
          { creates: false },
        );
      } catch (error) {
        if (!(error instanceof Unknown)) throw error;
        // A validate-only request creates nothing: it is recorded unknown and the run goes on.
        validations.push({ name: candidate.name, status: "unknown" });
        continue;
      }
      validations.push({
        name: candidate.name,
        status: r.status,
        error: r.json.error?.status ?? null,
        message: r.json.error?.message ?? null,
      });
      if (r.status === 200) accepted.push(candidate);
    }
    let serverTag = base.server.etag;
    const s1 = created(
      "server",
      "s1",
      await write(
        "s1-publish",
        "server",
        urls.server,
        "PUT",
        serverTemplate(accepted, { description: `fireemu rc-observe ${runId} s1` }),
        serverTag,
      ),
    );
    serverTag = s1.etag;
    const plane = await t.send("s2-data-plane", urls.dataPlane);
    dataPlane = plane.status === 200 ? plane.json : null;
    result.dataPlaneStatus = plane.status;
    await read("s3-server-admin", urls.server);
    // Item 7: wildcard If-Match on the server namespace, on a version without a description.
    const s4 = await write(
      "s4-wildcard",
      "server",
      urls.server,
      "PUT",
      serverTemplate(accepted, { top: "wildcard" }),
      "*",
    );
    wildcard = {
      status: s4.status,
      error: s4.json.error?.status ?? null,
      message: s4.json.error?.message ?? null,
    };
    if (s4.status === 200) created("server", "s4", s4);
    created(
      "server",
      "s5",
      await write("s5-rollback", "server", `${urls.server}:rollback`, "POST", {
        versionNumber: String(base.server.version),
      }),
    );
    const s6 = await read("s6-server", urls.server);
    if (!isEmptyTemplate(s6.json))
      throw new Stop("server rollback did not restore the empty template");

    // ---- C. client chain (ordering, duplicates, the version without a description) ----
    for (const step of ["c1", "c2", "c3"]) {
      const v = created(
        "client",
        step,
        await write(
          `${step}-publish`,
          "client",
          urls.client,
          "PUT",
          clientTemplate(step, runId),
          clientTag,
        ),
      );
      clientTag = v.etag;
    }
    created(
      "client",
      "c4",
      await write("c4-rollback", "client", `${urls.client}:rollback`, "POST", {
        versionNumber: String(base.client.version),
      }),
    );
    const c5 = await read("c5-client", urls.client);
    if (!isEmptyTemplate(c5.json))
      throw new Stop("client rollback did not restore the empty template");

    // ---- H. version metadata (updateUser) ----
    for (const [namespace, url] of [
      ["client", urls.client],
      ["server", urls.server],
    ]) {
      const h = await t.send(`h-${namespace}-history`, `${url}:listVersions?pageSize=8`);
      history[namespace] = h.status === 200 ? h.json : null;
    }

    // ---- F. delivery window ----
    for (let i = 0; i < timing.windowReads; i += 1) {
      await wait(timing.windowMs);
      await collect(`f-events-${i}`);
    }
  } catch (error) {
    result.stopped =
      error instanceof Stop || error instanceof Unknown ? error.message : `error: ${error.message}`;
  } finally {
    // ---- G. restoration and cleanup ----
    result.baseline.after = {};
    for (const [namespace, url] of [
      ["client", urls.client],
      ["server", urls.server],
    ]) {
      try {
        let r = await t.send(`g-${namespace}`, url);
        if (
          r.status === 200 &&
          !isEmptyTemplate(r.json) &&
          sent[namespace] &&
          base[namespace]?.version
        ) {
          const back = await write(`g-${namespace}-restore`, namespace, `${url}:rollback`, "POST", {
            versionNumber: String(base[namespace].version),
          });
          if (back.status === 200) created(namespace, "restore", back);
          r = await t.send(`g-${namespace}-after-restore`, url);
        }
        result.baseline.after[namespace] = {
          status: r.status,
          empty: r.status === 200 && isEmptyTemplate(r.json),
          version: r.json.version?.versionNumber ?? null,
        };
      } catch (error) {
        result.open.push(`g-${namespace}: ${error.message}`);
      }
    }
    if (prod) {
      const f = prod.functions;
      for (const step of [() => f.remove(2), () => f.remove(1), () => f.removeSource()]) {
        try {
          await step();
        } catch (error) {
          result.open.push(`cleanup: ${error.message}`);
        }
      }
      result.open.push(...f.open);
      for (const [generation, s] of Object.entries(f.state))
        if (s.pending) result.open.push(`gen${generation}: create not settled`);
      try {
        const iam = await t.send("g-iam", prod.google.iam, { method: "POST", body: {} });
        result.baseline.iamEqual =
          iam.status === 200 && canonicalBindings(iam.json) === result.baseline.iamBefore;
        result.baseline.functionsAfter = await listFunctions(
          t,
          prod.google.functions,
          "g-functions",
        );
        result.baseline.functionsEqual =
          JSON.stringify(result.baseline.functionsAfter) ===
          JSON.stringify(result.baseline.functionsBefore);
      } catch (error) {
        result.open.push(`g-baseline: ${error.message}`);
      }
    }
  }
  const after = result.baseline.after;
  result.sandboxAtBaseline =
    Boolean(after.client?.empty && after.server?.empty) &&
    (!prod || (result.baseline.iamEqual === true && result.baseline.functionsEqual === true)) &&
    result.open.length === 0;
  result.unknown = [...t.unknown];
  result.requests = t.count;
  result.versions = versions;
  const events = [...rows.values()].map((row, i) => normalise(row, i));
  result.summary = summarise({
    events,
    versions,
    history,
    dataPlane,
    wildcard,
    validations,
    open: result.open,
    truncated: logReads.some((r) => r.truncated),
  });
  result.logReads = logReads;
  // What A2 needs to read back whatever state the creates ended in (ruling 1, S3).
  if (prod)
    result.resources = {
      functions: Object.fromEntries(
        Object.entries(prod.functions.state).map(([g, st]) => [`gen${g}`, { ...st }]),
      ),
      managed: [...prod.functions.grants.managed],
      source: prod.functions.grants.source,
    };
  result.complete =
    result.stopped === null &&
    result.sandboxAtBaseline &&
    result.unknown.length === 0 &&
    !logReads.some((r) => r.truncated);
  return { result, events };
}

/**
 * The A2 read-back (read-only, at most 11 requests): both templates, the run's two function names,
 * the Gen2 trigger, service and source object the run recorded, the functions list and the project
 * IAM policy. Any failure is recorded in the answer (never thrown), and the answer is then not at
 * baseline. It settles nothing by itself: the coordinator reads it against the run's open items, at
 * least 10 minutes after the run's last request.
 */
export async function readBack(ctx, resources = null) {
  const { transport: t, urls, production: prod } = ctx;
  const out = {
    runId: ctx.runId,
    templates: {},
    functions: {},
    managed: {},
    source: null,
    errors: [],
  };
  const step = async (name, run) => {
    try {
      await run();
    } catch (error) {
      out.errors.push(`${name}: ${error.message}`);
    }
  };
  for (const [namespace, url] of [
    ["client", urls.client],
    ["server", urls.server],
  ])
    await step(`a2-${namespace}`, async () => {
      const r = await t.send(`a2-${namespace}`, url);
      out.templates[namespace] = {
        status: r.status,
        empty: r.status === 200 && isEmptyTemplate(r.json),
        version: r.json.version?.versionNumber ?? null,
      };
    });
  for (const generation of [1, 2])
    await step(`a2-gen${generation}`, async () => {
      out.functions[`gen${generation}`] = (
        await t.send(`a2-gen${generation}`, prod.functions.url(generation))
      ).status;
    });
  const grants = prod.functions.grants;
  const own = `projects/(${prod.functions.project}|${prod.functions.number})/locations/`;
  for (const [i, key] of (resources?.managed ?? []).entries())
    await step(`a2-managed-${i}`, async () => {
      if (!new RegExp(`^${own}(global|${REGION})/(triggers|services)/[A-Za-z0-9_.-]+$`).test(key))
        throw new Error("managed resource outside the read-back scope");
      grants.managed.add(key);
      const origin = key.includes("/triggers/")
        ? "https://eventarc.googleapis.com/v1/"
        : "https://run.googleapis.com/v2/";
      out.managed[key] = (await t.send(`a2-managed-${i}`, origin + key)).status;
    });
  if (resources?.source)
    await step("a2-source", async () => {
      if (
        resources.source.bucket !==
        `gcf-v2-uploads-${prod.functions.number}.${REGION}.cloudfunctions.appspot.com`
      )
        throw new Error("source object outside the sandbox upload bucket");
      grants.source = resources.source;
      const object = `https://storage.googleapis.com/storage/v1/b/${resources.source.bucket}/o/${encodeURIComponent(resources.source.object)}`;
      out.source = (await t.send("a2-source", object)).status;
    });
  await step("a2-functions", async () => {
    out.functionsList = await listFunctions(t, prod.google.functions, "a2-functions");
  });
  await step("a2-iam", async () => {
    const iam = await t.send("a2-iam", prod.google.iam, { method: "POST", body: {} });
    out.iam = { status: iam.status, bindings: canonicalBindings(iam.json) };
  });
  out.requests = t.count;
  out.unknown = [...t.unknown];
  // A Gen2 create that never named its trigger and service leaves them unread: not at baseline.
  const gen2Attempted = resources?.functions?.gen2?.attempted === true;
  const managedKnown = !gen2Attempted || (resources?.managed ?? []).length === 2;
  out.managedKnown = managedKnown;
  out.atBaseline =
    out.errors.length === 0 &&
    out.unknown.length === 0 &&
    resources !== null &&
    out.templates.client?.empty === true &&
    out.templates.server?.empty === true &&
    out.functions.gen1 === 404 &&
    out.functions.gen2 === 404 &&
    managedKnown &&
    Object.values(out.managed).every((status) => status === 404) &&
    (resources.source === null || out.source === 404);
  return out;
}

async function listFunctions(t, url, prefix) {
  const found = [];
  let token = "";
  for (let page = 0; page < 3; page += 1) {
    const r = await t.send(
      `${prefix}-${page}`,
      `${url}?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
    );
    if (r.status !== 200) throw new Error(`${prefix}: functions list ${r.status}`);
    found.push(...(r.json.functions ?? []).map((fn) => fn.name));
    token = r.json.nextPageToken ?? "";
    if (!token) return found.sort();
  }
  throw new Error(`${prefix}: more than three pages of functions`);
}

/** Rows the local firebase-functions handlers appended (one JSON object per line). */
export function readLocalEvents(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => ({ ...JSON.parse(line), insertId: `local-${i}` }));
}

export function newRunId(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(2, 14);
  return `${stamp}${Math.floor(Math.random() * 46656)
    .toString(36)
    .padStart(3, "0")}`;
}

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--send-production") args.send = true;
    else if (["--target", "--base", "--project", "--events-file", "--out", "--a2-of"].includes(a))
      args[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

export async function main(argv, env = process.env) {
  const args = parse(argv);
  if (!args.out) throw new Error("--out is required");
  const out = resolve(args.out);
  if (existsSync(out)) throw new Error("--out must not exist");
  // The A2 read-back of an earlier production run reuses its run id (and so its function names).
  const runId = args["a2-of"]
    ? JSON.parse(readFileSync(join(resolve(args["a2-of"]), "run.json"), "utf8")).runId
    : newRunId();
  if (args["a2-of"] && args.target !== "production") throw new Error("--a2-of is production only");
  let ctx;
  if (args.target === "local") {
    if (args.send) throw new Error("--send-production is for the production target only");
    if (!args.base || !args.project || !args["events-file"] || !env.FIREEMU_CONTROL_TOKEN)
      throw new Error("local needs --base, --project, --events-file and FIREEMU_CONTROL_TOKEN");
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const token = env.FIREEMU_CONTROL_TOKEN;
    const transport = new Transport({
      out,
      allow: localAllow(args.base),
      token: () => token,
      maxRequests: MAX_REQUESTS,
      timeoutMs: LOCAL_TIMING.timeoutMs,
    });
    ctx = {
      transport,
      urls: templateUrls(args.base, args.project),
      runId,
      timing: LOCAL_TIMING,
      events: async () => ({ rows: readLocalEvents(args["events-file"]), truncated: false }),
    };
  } else if (args.target === "production") {
    if (args.send !== true) throw new Error("production needs --send-production");
    const number = env.FIREEMU_SANDBOX_PROJECT_NUMBER;
    if (!/^[1-9][0-9]{5,}$/.test(number ?? ""))
      throw new Error("FIREEMU_SANDBOX_PROJECT_NUMBER is required");
    for (const v of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN"])
      if (env[v]) throw new Error(`${v} must be unset`);
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const project = PRODUCTION_PROJECT;
    const n = runNames(runId);
    const grants = newGrants();
    let cached = null;
    const token = () => {
      if (!cached || Date.now() - cached.at > 30 * 60_000)
        cached = {
          at: Date.now(),
          value: execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
            encoding: "utf8",
          }).trim(),
        };
      return cached.value;
    };
    const transport = new Transport({
      out,
      allow: productionAllow({ project, number, names: n, grants }),
      token,
      maxRequests: args["a2-of"] ? A2_MAX_REQUESTS : MAX_REQUESTS,
      timeoutMs: PRODUCTION_TIMING.timeoutMs,
      userProject: project,
    });
    const functions = new Functions({ transport, project, number, names: n, runId, grants });
    const started = new Date().toISOString();
    const services = new URL(
      `https://serviceusage.googleapis.com/v1/projects/${project}/services:batchGet`,
    );
    for (const s of SERVICES)
      services.searchParams.append("names", `projects/${project}/services/${s}`);
    ctx = {
      transport,
      urls: templateUrls(RC_API, project),
      runId,
      timing: PRODUCTION_TIMING,
      events: (caseId) => functions.logs(caseId, started),
      production: {
        functions,
        google: {
          services: services.href,
          repository: `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${REGION}/repositories/gcf-artifacts`,
          iam: `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,
          functions: `${GCF}/v2/projects/${project}/locations/-/functions`,
        },
      },
    };
  } else throw new Error("--target must be local or production");
  if (args["a2-of"]) {
    writeFileSync(
      join(out, "run.json"),
      JSON.stringify({ runId, a2Of: resolve(args["a2-of"]), startedAt: new Date().toISOString() }) +
        "\n",
    );
    let resources = null;
    try {
      resources =
        JSON.parse(readFileSync(join(resolve(args["a2-of"]), "result.json"), "utf8")).resources ??
        null;
    } catch {
      // No result.json (a crashed run): A2 reads what it can and is not at baseline.
    }
    const back = await readBack(ctx, resources);
    writeFileSync(join(out, "a2.json"), JSON.stringify(back, null, 2) + "\n");
    console.log(JSON.stringify(back));
    return back.atBaseline ? 0 : 1;
  }
  writeFileSync(
    join(out, "run.json"),
    JSON.stringify({ runId, target: args.target, startedAt: new Date().toISOString() }) + "\n",
  );
  const { result, events } = await observe(ctx);
  writeFileSync(join(out, "events.json"), JSON.stringify(events, null, 2) + "\n");
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify({
      runId,
      complete: result.complete,
      stopped: result.stopped,
      requests: result.requests,
      unknown: result.unknown,
      open: result.open,
      sandboxAtBaseline: result.sandboxAtBaseline,
    }),
  );
  return result.complete ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
