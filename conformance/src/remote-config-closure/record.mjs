// RC-CLOSURE-A recorder: one pass of the closure corpus (corpus.mjs) against one target, for the
// six recorded REMOTE-CONFIG conditions. Built on the reviewed RC-OBSERVE-V2-3 recorder
// (../remote-config-observe): its transport, its Gen1/Gen2 handler deploys and log reads, its
// allow list and A2 read-back, unchanged; this module adds the corpus program and the Remote Config
// request forms it needs.
//
//   node src/remote-config-closure/record.mjs --target local --base <control apiBaseUrl>
//     --project <id> --events-file <jsonl the local handlers append to> --out <new dir>
//   node src/remote-config-closure/record.mjs --target production --send-production --out <new dir>
//   node src/remote-config-closure/record.mjs --target production --send-production --a2-of <run dir> --out <new dir>
//
// local reads FIREEMU_CONTROL_TOKEN; production reads FIREEMU_SANDBOX_PROJECT_NUMBER and the
// caller's ADC token from gcloud. Production is sent only with --send-production, which only the
// packet's launch script passes; no test passes it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Functions, GCF, newGrants } from "../remote-config-observe/functions.mjs";
import {
  PRODUCTION_PROJECT,
  REGION,
  candidateTemplate,
  isEmptyTemplate,
  names as runNames,
  normalise,
} from "../remote-config-observe/plan.mjs";
import {
  A2_MAX_REQUESTS,
  listFunctions,
  localAllow,
  newRunId,
  productionAllow as observeAllow,
  readBack,
  readLocalEvents,
} from "../remote-config-observe/record.mjs";
import { Transport, Unknown } from "../remote-config-observe/transport.mjs";
import {
  CANDIDATES,
  DEFAULTS,
  MALFORMED_TAG,
  READS,
  clientDraft,
  conditionDrafts,
  historyQueries,
  serverTemplate,
  validationDrafts,
} from "./corpus.mjs";

export { A2_MAX_REQUESTS };

// Request cap of a production pass, phase bounds as packet section 3: baseline 8 + deploys 89 and
// one log read + reads 11 + validation 81 + publication and defaults 16 + history 17 + rollbacks
// and version reads 4 + server 31 + client restoration 3 + window 10 + cleanup 107 = 378. The
// transport refuses every request past the cap.
export const MAX_REQUESTS = 400;
export const PRODUCTION_TIMING = {
  paceMs: 2500,
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

/** Whether `value` is an RFC 3339 UTC time of a real calendar instant (fraction of 0 to 9 digits). */
export function validTime(value) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/.test(value))
    return false;
  // A field out of its range moves the instant (02-30 becomes 03-02), so the round trip differs.
  const date = new Date(`${value.slice(0, 19)}Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

/**
 * The history requests a pass may make, granted as it plans them (RC-CLOSURE-A ruling 7 item 1):
 * each planned query once, its times only the values the pass generated and only valid RFC 3339
 * times (`startTime=invalid` is the planned invalid value), and the next page only with the token
 * the pass's own page answer returned, once.
 */
export function newHistoryGrants() {
  const queries = new Set();
  return {
    queries,
    /** Grants one planned query (URLSearchParams form); refuses an invalid time. */
    plan(search) {
      for (const [key, value] of new URLSearchParams(search))
        if ((key === "startTime" || key === "endTime") && value !== "invalid" && !validTime(value))
          throw new Error(`history: ${key} ${value} is not a valid RFC 3339 time`);
      queries.add(search);
    },
    /** Admits a planned query once. */
    take(search) {
      return queries.delete(search);
    },
  };
}

/**
 * The Remote Config forms the corpus adds to the RC-OBSERVE-V2-3 allow list, bound to the API host:
 * client reads with the recorded version queries, the explicit, unknown-namespace and project-number
 * reads, client validation, the defaults downloads, the history queries of the pass and the client
 * history page of the server namespace.
 */
export function closureForms({ project, number, history = newHistoryGrants() }) {
  const rc = `/v1/projects/${project}/`;
  const client = `${rc}remoteConfig`;
  const exact = new Set([
    `GET ${client}`,
    `GET ${rc}namespaces/firebase/remoteConfig`,
    `GET ${rc}namespaces/fireemu-absent-ns/remoteConfig`,
    `GET /v1/projects/${number}/remoteConfig`,
    `GET ${client}?versionNumber=0`,
    `GET ${client}?versionNumber=9223372036854775807`,
    `GET ${client}?versionNumber=invalid`,
    `PUT ${client}?validateOnly=true`,
    ...DEFAULTS.map(([, path]) => `GET ${rc}${path}`),
  ]);
  return (url, method) => {
    if (url.protocol !== "https:" || url.host !== "firebaseremoteconfig.googleapis.com")
      return false;
    if (url.username || url.password || url.port) return false;
    if (exact.has(`${method} ${url.pathname}${url.search}`)) return true;
    if (method !== "GET") return false;
    if (
      url.pathname === client &&
      /^\?(?:versionNumber|version_number)=[1-9][0-9]{0,11}$/.test(url.search)
    )
      return true;
    return url.pathname === `${client}:listVersions` && history.take(url.search);
  };
}

export function templateUrls(base, project, number) {
  const root = new URL(`projects/${project}/`, base);
  return {
    root: root.href,
    numbered: number ? new URL(`projects/${number}/remoteConfig`, base).href : null,
    client: new URL("remoteConfig", root).href,
    server: new URL("namespaces/firebase-server/remoteConfig", root).href,
    dataPlane: new URL("namespaces/firebase-server/serverRemoteConfig", root).href,
  };
}

class Stop extends Error {}

/**
 * The accepted publication of the two concurrent ones (Promise.allSettled results): every unknown
 * answer is opened and stops the pass, and anything but exactly one 200 stops it.
 */
export function raceWinner(settled, open) {
  // Every unknown race publication is opened before the pass stops (ruling 7 item 2).
  const rejected = settled.flatMap((outcome, i) => (outcome.status === "rejected" ? [i] : []));
  for (const i of rejected)
    open.push(`p7-${i ? "race-b" : "race-a"}: unknown client write (A2 reads client)`);
  if (rejected.length) throw settled[rejected[0]].reason;
  const winners = settled.map((outcome) => outcome.value).filter((r) => r.status === 200);
  if (winners.length !== 1) throw new Stop(`race: ${winners.length} publications accepted`);
  return winners[0];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const canonicalBindings = (policy) =>
  JSON.stringify(
    (policy?.bindings ?? [])
      .map((b) => [b.role, [...(b.members ?? [])].sort(), b.condition ?? null])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );

/** Runs one pass. `ctx` as in the RC-OBSERVE-V2-3 recorder, with `urls` from templateUrls. */
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
  const sent = { client: false, server: false };
  const rows = new Map();
  let base = {};
  let lastWrite = 0;
  const logReads = [];

  const read = async (caseId, url, options) => {
    const r = await t.send(caseId, url, options);
    if (r.status !== 200 || !r.etag) throw new Error(`${caseId}: template read ${r.status}`);
    return r;
  };
  const pace = async () => {
    const gap = lastWrite + timing.paceMs - Date.now();
    if (gap > 0) await wait(gap);
    // Local runs move the virtual clock so the versions get distinct update times.
    if (ctx.tick) await ctx.tick();
  };
  // A write. An unknown answer of a write that creates stops the forward program.
  const write = async (caseId, namespace, url, method, body, ifMatch, { creates = true } = {}) => {
    await pace();
    if (creates) sent[namespace] = true;
    let r;
    try {
      r = await t.send(caseId, url, { method, body, ifMatch });
    } catch (error) {
      if (error instanceof Unknown && creates)
        result.open.push(`${caseId}: unknown ${namespace} write (A2 reads ${namespace})`);
      throw error;
    } finally {
      lastWrite = Date.now();
    }
    // A 429 on a write that creates stops the forward program (packet section 3; ruling 7 item 4).
    if (creates && r.status === 429) throw new Stop(`${caseId}: 429`);
    return r;
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
  const collect = async (caseId) => {
    const got = await ctx.events(caseId);
    logReads.push({ case: caseId, rows: got.rows.length, truncated: got.truncated });
    for (const row of got.rows) rows.set(row.insertId ?? JSON.stringify(row), row);
  };
  // A validate-only request creates nothing: an unknown answer is recorded and the pass goes on.
  const validate = async (caseId, body, ifMatch) => {
    try {
      return await write(
        caseId,
        "client",
        `${urls.client}?validateOnly=true`,
        "PUT",
        body,
        ifMatch,
        { creates: false },
      );
    } catch (error) {
      if (!(error instanceof Unknown)) throw error;
      return null;
    }
  };

  try {
    // ---- A. baseline (read-only), as RC-OBSERVE-V2-3 ----
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
      if (!result.baseline.repository.cleanupPolicies.includes("firebase-functions-cleanup"))
        throw new Stop("gcf-artifacts has no firebase-functions-cleanup policy");
      const iam = await t.send("a-iam", g.iam, { method: "POST", body: {} });
      if (iam.status !== 200) throw new Stop("project IAM unreadable");
      result.baseline.iamBefore = canonicalBindings(iam.json);
      result.baseline.functionsBefore = await prod.listFunctions("a-functions");
      const own = [prod.functions.names.gen1, prod.functions.names.gen2];
      if (
        result.baseline.functionsBefore.some((n) => own.some((o) => n.endsWith(`/functions/${o}`)))
      )
        throw new Stop("a fresh function name already exists");
      // ---- B. deploy, one at a time ----
      for (const generation of [1, 2])
        if (!(await prod.functions.deploy(generation)))
          throw new Stop(`gen${generation} deploy did not complete`);
      await wait(timing.readyMs);
      await collect("b-logs-baseline");
      if (rows.size) throw new Stop("rows with this run's marker before any publish");
    }

    // ---- R. template reads (template-read) ----
    for (const [caseId, form] of READS) {
      let url = urls.client;
      if (form.path) url = new URL(`./${form.path}`, urls.root).href;
      if (form.number) url = urls.numbered ?? urls.client;
      if (form.query) url = `${urls.client}?${form.query.replace("BASELINE", base.client.version)}`;
      await t.send(caseId, url, {
        ...(form.gzip === false ? { gzip: false } : {}),
        ...(form.credentials === false ? { credentials: false } : {}),
        ...(form.ifNoneMatch ? { ifNoneMatch: base.client.etag, notModified: true } : {}),
      });
    }

    // ---- V. client validation (template-validation): state and events unchanged ----
    await read("v-before", urls.client);
    await validate("v-missing-precondition", clientDraft("validate", runId), undefined);
    await validate("v-malformed-tag", clientDraft("validate", runId), MALFORMED_TAG);
    await validate("v-wildcard", clientDraft("validate", runId), "*");
    for (const [caseId, body] of [...validationDrafts(), ...conditionDrafts()])
      await validate(caseId, body, base.client.etag);
    const after = await read("v-after", urls.client);
    if (after.etag !== base.client.etag) throw new Stop("validation changed the client template");

    // ---- P. client publication (template-publish), the control before the server phase ----
    let clientTag = base.client.etag;
    const p1 = created(
      "client",
      "p1",
      await write(
        "p1-publish",
        "client",
        urls.client,
        "PUT",
        clientDraft("first", runId),
        clientTag,
      ),
    );
    clientTag = p1.etag;
    for (const [caseId, path, file] of DEFAULTS)
      await t.send(caseId, new URL(`./${path}`, urls.root).href, { textBody: file });
    await write(
      "p2-missing",
      "client",
      urls.client,
      "PUT",
      clientDraft("second", runId),
      undefined,
      { creates: false },
    );
    await write(
      "p3-stale",
      "client",
      urls.client,
      "PUT",
      clientDraft("second", runId),
      base.client.etag,
      { creates: false },
    );
    await write(
      "p4-malformed",
      "client",
      urls.client,
      "PUT",
      clientDraft("second", runId),
      MALFORMED_TAG,
      { creates: false },
    );
    const p5 = created(
      "client",
      "p5",
      await write("p5-wildcard", "client", urls.client, "PUT", clientDraft("second", runId), "*"),
    );
    clientTag = p5.etag;
    const p6a = created(
      "client",
      "p6a",
      await write(
        "p6a-publish",
        "client",
        urls.client,
        "PUT",
        clientDraft("same", runId),
        clientTag,
      ),
    );
    const p6b = created(
      "client",
      "p6b",
      await write("p6b-same", "client", urls.client, "PUT", clientDraft("same", runId), p6a.etag),
    );
    clientTag = p6b.etag;
    // Two concurrent publications with one tag, each with two conditions (2026-11-21 race).
    await pace();
    sent.client = true;
    const race = await Promise.allSettled(
      ["race-a", "race-b"].map((label) =>
        t.send(`p7-${label}`, urls.client, {
          method: "PUT",
          body: clientDraft(label, runId),
          ifMatch: clientTag,
        }),
      ),
    );
    lastWrite = Date.now();
    const won = created("client", "p7", raceWinner(race, result.open));
    const current = await read("p8-current", urls.client);
    if (current.etag !== won.etag)
      throw new Stop("race: the current version is not the accepted one");
    clientTag = won.etag;

    // ---- H. history (version-history-and-rollback) ----
    const times = [p5, p6a, p6b].map((v) => v.updateTime);
    if (times.some((time) => typeof time !== "string"))
      throw new Stop("a version has no updateTime");
    const history = ctx.history ?? newHistoryGrants();
    const queries = historyQueries({ times, end: p6a.versionNumber }).map(([caseId, query]) => [
      caseId,
      `?${new URLSearchParams(query)}`,
    ]);
    for (const [, search] of queries) history.plan(search);
    for (const [caseId, search] of queries) {
      const r = await t.send(caseId, `${urls.client}:listVersions${search}`);
      if (caseId === "h-page") {
        const token = r.json.nextPageToken;
        if (r.status === 200 && /^[1-9][0-9]{0,11}$/.test(token ?? "")) {
          const next = `?${new URLSearchParams({ pageSize: "2", pageToken: token })}`;
          history.plan(next);
          await t.send("h-next", `${urls.client}:listVersions${next}`);
        }
      }
    }
    // ---- K. rollbacks and version reads ----
    created(
      "client",
      "k1",
      await write("k1-rollback", "client", `${urls.client}:rollback`, "POST", {
        versionNumber: p1.versionNumber,
      }),
    );
    await write(
      "k2-rollback-unknown",
      "client",
      `${urls.client}:rollback`,
      "POST",
      { versionNumber: "9223372036854775807" },
      undefined,
      { creates: false },
    );
    await t.send("k3-version", `${urls.client}?versionNumber=${p1.versionNumber}`);
    await t.send("k4-version-snake", `${urls.client}?version_number=${p5.versionNumber}`);

    // ---- S. server namespace (server-template-evaluation), as RC-OBSERVE-V2-3 ----
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
        continue;
      }
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
        serverTemplate(accepted, { description: `fireemu rc-closure ${runId} s1` }),
        serverTag,
      ),
    );
    serverTag = s1.etag;
    await t.send("s2-data-plane", urls.dataPlane);
    await read("s3-server-admin", urls.server);
    const s4 = await write(
      "s4-wildcard",
      "server",
      urls.server,
      "PUT",
      serverTemplate(accepted, { top: "wildcard" }),
      "*",
    );
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
    await t.send("s7-history", `${urls.server}:listVersions?pageSize=8`);

    // ---- C. client restoration inside the delivery window ----
    created(
      "client",
      "c9",
      await write("c9-restore", "client", `${urls.client}:rollback`, "POST", {
        versionNumber: String(base.client.version),
      }),
    );
    const c10 = await read("c10-client", urls.client);
    if (!isEmptyTemplate(c10.json))
      throw new Stop("client rollback did not restore the empty template");
    await t.send("c11-history", `${urls.client}:listVersions?pageSize=8`);

    // ---- F. delivery window (publish-trigger) ----
    for (let i = 0; i < timing.windowReads; i += 1) {
      await wait(timing.windowMs);
      await collect(`f-events-${i}`);
    }
  } catch (error) {
    result.stopped =
      error instanceof Stop || error instanceof Unknown ? error.message : `error: ${error.message}`;
  } finally {
    // ---- G. restoration and cleanup, as RC-OBSERVE-V2-3 ----
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
          version: r.json?.version?.versionNumber ?? null,
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
        result.baseline.functionsAfter = await prod.listFunctions("g-functions");
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
  result.summary = summarise({ events, versions, truncated: logReads.some((r) => r.truncated) });
  result.logReads = logReads;
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
 * The per-generation delivery summary: events attributed to the pass's client and server versions
 * by version number and update time, duplicates, publication order, and the server answer, which is
 * evidence only when the first client publication (p1, before the server phase) reached the handler.
 */
export function summarise({ events, versions, truncated = false }) {
  const index = new Map(
    versions.map((v, i) => [`${v.versionNumber}|${v.updateTime}`, { ...v, i }]),
  );
  const numbers = (ns) =>
    new Set(versions.filter((v) => v.namespace === ns).map((v) => v.versionNumber));
  const server = numbers("server");
  const overlap = [...numbers("client")].some((n) => server.has(n));
  const out = { versionRangesOverlap: overlap, logTruncated: truncated, generations: {} };
  for (const generation of [1, 2]) {
    const own = events
      .filter((e) => e.generation === generation)
      .map((e) => ({ ...e, match: index.get(`${e.versionNumber}|${e.updateTime}`) ?? null }));
    const client = own.filter((e) => e.match?.namespace === "client");
    const ids = new Map();
    for (const e of own) ids.set(e.eventId, (ids.get(e.eventId) ?? 0) + 1);
    const control = client.some((e) => e.match.step === "p1");
    const serverEvents = own.filter((e) => e.match?.namespace === "server");
    out.generations[generation] = {
      events: own.length,
      unmatched: own.filter((e) => !e.match).length,
      clientSteps: client.map((e) => e.match.step),
      serverSteps: serverEvents.map((e) => e.match.step),
      serverDelivery: truncated
        ? "unknown-truncated-log-read"
        : !control || overlap
          ? "not-evidence"
          : serverEvents.length
            ? "delivered"
            : "none-within-window",
      duplicates: [...ids].filter(([, n]) => n > 1).map(([eventId, count]) => ({ eventId, count })),
      inPublicationOrder: client.every((e, i) => i === 0 || client[i - 1].match.i <= e.match.i),
    };
  }
  return out;
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

export async function main(argv, env = process.env, hooks = {}) {
  const args = parse(argv);
  if (!args.out) throw new Error("--out is required");
  const out = resolve(args.out);
  if (existsSync(out)) throw new Error("--out must not exist");
  const runId = args["a2-of"]
    ? JSON.parse(readFileSync(join(resolve(args["a2-of"]), "run.json"), "utf8")).runId
    : newRunId();
  if (args["a2-of"] && args.target !== "production") throw new Error("--a2-of is production only");
  let ctx;
  if (args.target === "local") {
    if (args.send) throw new Error("--send-production is for the production target only");
    if (!args.base || !args.project || !args["events-file"] || !env.FIREEMU_CONTROL_TOKEN)
      throw new Error("local needs --base, --project, --events-file and FIREEMU_CONTROL_TOKEN");
    if (!/^[1-9][0-9]{5,}$/.test(env.FIREEMU_LOCAL_PROJECT_NUMBER ?? ""))
      throw new Error("local needs FIREEMU_LOCAL_PROJECT_NUMBER (the number the daemon reports)");
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
      urls: templateUrls(args.base, args.project, env.FIREEMU_LOCAL_PROJECT_NUMBER),
      runId,
      timing: LOCAL_TIMING,
      events: async () => ({ rows: readLocalEvents(args["events-file"]), truncated: false }),
      tick: hooks.tick,
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
    const observeForms = observeAllow({ project, number, names: n, grants });
    const history = newHistoryGrants();
    const forms = closureForms({ project, number, history });
    const transport = new Transport({
      out,
      allow: (url, method, options) =>
        observeForms(url, method, options) || (!options?.signed && forms(url, method)),
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
    const functionsList = `${GCF}/v2/projects/${project}/locations/-/functions`;
    ctx = {
      transport,
      history,
      urls: templateUrls(RC_API, project, number),
      runId,
      timing: PRODUCTION_TIMING,
      events: (caseId) => functions.logs(caseId, started),
      production: {
        functions,
        listFunctions: (prefix) => listFunctions(transport, functionsList, prefix, grants),
        google: {
          services: services.href,
          repository: `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${REGION}/repositories/gcf-artifacts`,
          iam: `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,
          functions: functionsList,
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
