// RC-CLOSURE-B: one pass of the Web client corpus (REMOTE-CONFIG/client-fetch-and-activate and
// realtime-updates). The admin side (template writes, the API key's lifecycle, the read-only
// checks) goes through the journaled Transport; the client side is the pinned Web SDK in two
// browser contexts (driver.mjs), each a synthetic installation, whose exchanges page.mjs records
// already masked.
//
// Order: A baseline and assumptions (read-only), K the dedicated API key (created, its value held
// in memory only), T the client template, F fetches of both installations with two signal sets,
// R realtime on installation 1 across a changed, a metadata-only, a same-content and a rollback
// publication, then one reconnect and one more publication, G restoration: the baseline rollback,
// both installations deleted through the SDK, the key deleted and read back.
import { Unknown } from "../remote-config-observe/transport.mjs";

export const KEY_ID = "rc-closure-b-sdk";
export const WEB_APP = "listen-l1";
export const API_TARGETS = [
  "firebaseremoteconfig.googleapis.com",
  "firebaseremoteconfigrealtime.googleapis.com",
  "firebaseinstallations.googleapis.com",
];
/** The admin request cap of a pass and the page's (both installations together). */
export const MAX_ADMIN_REQUESTS = 60;
export const MAX_PAGE_REQUESTS = 80;
export const PRODUCTION_TIMING = {
  paceMs: 2500,
  streamOpenMs: 15_000,
  updateWindowMs: 60_000,
  quietWindowMs: 45_000,
  reconnectGapMs: 3000,
  pollMs: 3000,
  polls: 10,
};

/** The signal sets: S1 matches the custom-signal conditions, S2 falls through to percent. */
export const SIGNALS = {
  s1: { fireemu_tier: "premium", fireemu_level: 7 },
  s2: { fireemu_tier: "basic", fireemu_level: 3 },
};

const leaf = (value, valueType, conditional = {}) => ({
  defaultValue: { value },
  ...(Object.keys(conditional).length
    ? {
        conditionalValues: Object.fromEntries(
          Object.entries(conditional).map(([c, v]) => [c, { value: v }]),
        ),
      }
    : {}),
  valueType,
});

/** The client template of version `label` (v1 .. v5 of the pass). */
export function template(
  label,
  runId,
  { description = `fireemu rc-closure-b ${runId} ${label}` } = {},
) {
  return {
    version: { description },
    conditions: [
      {
        name: "fireemu_premium",
        expression: "app.customSignal['fireemu_tier'].exactlyMatches(['premium'])",
      },
      { name: "fireemu_level", expression: "app.customSignal['fireemu_level'] >= 5" },
      { name: "fireemu_half", expression: "percent('fireemu_seed') <= 50" },
    ],
    parameters: {
      fireemu_message: leaf(`${label}-default`, "STRING", {
        fireemu_premium: `${label}-premium`,
        fireemu_half: `${label}-half`,
      }),
      fireemu_limit: leaf("10", "NUMBER", { fireemu_level: "20" }),
      fireemu_enabled: leaf("false", "BOOLEAN", { fireemu_premium: "true" }),
      fireemu_payload: leaf('{"synthetic":true}', "JSON"),
      fireemu_inapp: { defaultValue: { useInAppDefault: true } },
    },
  };
}

class Stop extends Error {}
/** The open item of a key that may exist, cleared only by its proved deletion. */
export const KEY_OPEN =
  "k-create: the key may exist until its deletion is read back (A2 lists keys)";
const OPERATION = /^operations\/[A-Za-z0-9._-]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEmpty = (doc) =>
  !["parameters", "conditions", "parameterGroups"].some(
    (k) => doc?.[k] && typeof doc[k] === "object" && Object.keys(doc[k]).length > 0,
  );

/**
 * Runs one pass. `ctx`: { transport, urls: {client, services, webApps, keys}, project, number,
 * browser (driver.openBrowser), runId, timing, wait?, production: boolean }.
 */
export async function observe(ctx) {
  const { transport: t, urls, runId, timing, browser } = ctx;
  const wait = ctx.wait ?? sleep;
  const result = { runId, stopped: null, open: [], steps: [], baseline: {}, key: {}, clients: {} };
  const clients = {};
  let lastWrite = 0;
  let wrote = false;
  let keyName = null;
  let keyValue = null;
  const step = (name, detail = {}) =>
    result.steps.push({ name, at: new Date().toISOString(), ...detail });

  const pace = async () => {
    const gap = lastWrite + timing.paceMs - Date.now();
    if (gap > 0) await wait(gap);
  };
  /** A template write: an unknown answer opens the item and stops the forward program. */
  const write = async (caseId, url, method, body, ifMatch) => {
    await pace();
    wrote = true;
    try {
      const r = await t.send(caseId, url, { method, body, ifMatch });
      if (r.status === 429) throw new Stop(`${caseId}: 429`);
      if (r.status !== 200) throw new Stop(`${caseId}: ${r.status}`);
      return r;
    } catch (error) {
      if (error instanceof Unknown)
        result.open.push(`${caseId}: unknown client write (A2 reads client)`);
      throw error;
    } finally {
      lastWrite = Date.now();
    }
  };
  /**
   * Polls an operation of the API Keys service until done; null when not done in the budget.
   * Every API Keys answer but the lists is secret: a done operation carries the key's value.
   */
  const operation = async (prefix, name, polls = timing.polls) => {
    // Only an operation this pass's own create or delete returned, in the expected form, may be
    // read (ruling 16 item 5).
    if (!OPERATION.test(name ?? "")) throw new Stop(`${prefix}: unexpected operation name`);
    ctx.grant?.("operation", name);
    for (let i = 0; i < polls; i += 1) {
      const op = await t.send(`${prefix}-poll-${i}`, `${urls.keysApi}${name}`, { secret: true });
      if (op.status !== 200) throw new Stop(`${prefix}: operation read ${op.status}`);
      if (op.json.done) return op.json;
      await wait(timing.pollMs);
    }
    return null;
  };
  /** Waits until `done()` or the window ends; returns whether it happened. */
  const until = async (done, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await done()) return true;
      if (browser.stopped()) throw new Stop(`browser: ${browser.stopped()}`);
      await wait(500);
    }
    return false;
  };
  /** A 429 on the page's side stops the forward program as an admin 429 does (ruling 16 item 6). */
  const throttled = async () => {
    for (const [name, client] of Object.entries(clients))
      if ((await client.wire()).some((e) => e.status === 429)) throw new Stop(`page ${name}: 429`);
  };
  const streams = async (client) =>
    (await client.wire()).filter((e) => e.path.endsWith(":streamFetchInvalidations")).length;

  /** Deletes the pass's key and reads it back; the problem, or null when it reads deleted. */
  const deleteKey = async (name) => {
    try {
      const deleted = await t.send("k-delete", `${urls.keysApi}${name}`, {
        method: "DELETE",
        secret: true,
      });
      if (deleted.status !== 200) return `k-delete: ${deleted.status}`;
      const done = await operation("k-delete", deleted.json.name);
      if (!done || done.error) return "k-delete: operation not done without error";
      const back = await t.send("k-readback", `${urls.keysApi}${name}`, { secret: true });
      result.key.deleted = back.status === 200 && typeof back.json.deleteTime === "string";
      return result.key.deleted ? null : "k-readback: no deleteTime";
    } catch (error) {
      result.key.deleted = false;
      return error.message;
    }
  };

  /** A key name of this project in the expected form, granted; a Stop otherwise. */
  const grantKey = (name) => {
    if (
      !new RegExp(`^projects/${ctx.number}/locations/global/keys/[A-Za-z0-9-]+$`).test(name ?? "")
    )
      throw new Stop("k-create: unexpected key name");
    ctx.grant?.("key", name);
    return name;
  };
  let createOperation = null;

  let base = null;
  try {
    // ---- A. baseline and assumptions (read-only) ----
    const a = await t.send("a-client", urls.client);
    if (a.status !== 200 || !isEmpty(a.json) || !a.json.version?.versionNumber)
      throw new Stop("the client template is not at the published empty baseline");
    base = { version: String(a.json.version.versionNumber), etag: a.etag };
    result.baseline.before = { version: base.version, empty: true };
    if (ctx.production) {
      const services = await t.send("a-services", urls.services);
      const states = Object.fromEntries(
        (services.json.services ?? []).map((s) => [s.config?.name ?? s.name, s.state]),
      );
      result.baseline.services = states;
      if (services.status !== 200 || !API_TARGETS.every((s) => states[s] === "ENABLED"))
        throw new Stop("a required API is not ENABLED");
      // Every assumption read must be a complete 200 before any write (ruling 16 item 2).
      const apps = await t.send("a-web-apps", urls.webApps);
      if (apps.status !== 200 || apps.json.nextPageToken)
        throw new Stop(`web apps list not complete (${apps.status})`);
      const app = (apps.json.apps ?? []).find((x) => x.displayName === WEB_APP);
      if (!app?.appId) throw new Stop(`web app ${WEB_APP} not found`);
      ctx.appId = app.appId;
      const keys = await t.send("a-keys", urls.keysList);
      if (keys.status !== 200 || keys.json.nextPageToken)
        throw new Stop(`key list not complete (${keys.status})`);
      if ((keys.json.keys ?? []).some((k) => k.displayName === KEY_ID && !k.deleteTime))
        throw new Stop(`a live key named ${KEY_ID} already exists`);
    }

    // ---- K. the dedicated API key ----
    if (ctx.production) {
      await pace();
      // The key may exist from the moment the create is sent: the item is open until its deletion
      // is read back (ruling 16 item 3). An unknown create or create poll is never settled by an
      // absence; it needs the owner's acceptance or a recovery packet.
      result.open.push(KEY_OPEN);
      result.key.createRequested = true;
      const created = await t.send("k-create", urls.keysCreate, {
        method: "POST",
        body: {
          displayName: KEY_ID,
          restrictions: { apiTargets: API_TARGETS.map((service) => ({ service })) },
        },
        secret: true,
      });
      if (created.status !== 200) throw new Stop(`k-create: ${created.status}`);
      createOperation = created.json.name ?? null;
      const done = await operation("k-create", createOperation);
      if (!done || done.error || !done.response?.name) throw new Stop("key create not settled");
      keyName = grantKey(done.response.name);
      result.key.created = true;
      const value = await t.send("k-value", `${urls.keysApi}${keyName}/keyString`, {
        secret: true,
      });
      if (value.status !== 200 || typeof value.json.keyString !== "string")
        throw new Stop("key value unreadable");
      keyValue = value.json.keyString;
    } else keyValue = ctx.fakeKey;
    const config = {
      apiKey: keyValue,
      projectId: ctx.project,
      appId: ctx.appId,
      messagingSenderId: ctx.number,
      authDomain: `${ctx.project}.firebaseapp.com`,
    };

    // ---- T. the client template ----
    let tag = base.etag;
    const v1 = await write("t1-publish", urls.client, "PUT", template("v1", runId), tag);
    tag = v1.etag;
    step("t1", { version: v1.json.version?.versionNumber ?? null });

    // ---- F. fetches of both installations ----
    clients.one = await browser.client(config);
    clients.two = await browser.client(config);
    for (const [name, signals] of [
      ["one", SIGNALS.s1],
      ["two", SIGNALS.s2],
    ]) {
      const first = await clients[name].call("fetch", signals);
      const again = await clients[name].call("fetch", signals);
      result.clients[name] = { fetches: [first, again] };
      step(`f-${name}`, { first: first.lastFetchStatus, again: again.lastFetchStatus });
      if ([first, again].some((f) => f.lastFetchStatus === "throttle"))
        throw new Stop(`f-${name}: throttled`);
      await throttled();
    }

    // ---- R. realtime on installation one ----
    const one = clients.one;
    await one.call("listen");
    const opened = await until(async () => (await streams(one)) >= 1, timing.streamOpenMs);
    step("r-open", { opened });
    if (!opened) throw new Stop("the realtime stream did not open");
    const publications = [
      ["r1-changed", () => write("r1-changed", urls.client, "PUT", template("v2", runId), tag)],
      [
        "r2-metadata",
        () =>
          write(
            "r2-metadata",
            urls.client,
            "PUT",
            template("v2", runId, { description: `fireemu rc-closure-b ${runId} v2 metadata` }),
            tag,
          ),
      ],
      [
        "r3-same",
        () =>
          write(
            "r3-same",
            urls.client,
            "PUT",
            template("v2", runId, { description: `fireemu rc-closure-b ${runId} v2 metadata` }),
            tag,
          ),
      ],
      [
        "r4-rollback",
        () =>
          write("r4-rollback", `${urls.client}:rollback`, "POST", {
            versionNumber: step2Version(),
          }),
      ],
    ];
    let v2 = null;
    const step2Version = () => v2;
    for (const [name, publish] of publications) {
      const before = (await one.updates()).length;
      const r = await publish();
      if (name === "r1-changed") v2 = r.json.version?.versionNumber ?? null;
      tag = r.etag;
      const window = name === "r1-changed" ? timing.updateWindowMs : timing.quietWindowMs;
      const updated = await until(async () => (await one.updates()).length > before, window);
      step(name, { version: r.json.version?.versionNumber ?? null, updated });
      await throttled();
    }
    // One reconnect: the listener closed and opened again, then one more changed publication.
    await one.call("unlisten");
    await wait(timing.reconnectGapMs);
    const streamsBefore = await streams(one);
    await one.call("listen");
    const reopened = await until(
      async () => (await streams(one)) > streamsBefore,
      timing.streamOpenMs,
    );
    step("r-reopen", { reopened });
    const before = (await one.updates()).length;
    const v5 = await write("r5-changed", urls.client, "PUT", template("v5", runId), tag);
    tag = v5.etag;
    const updated = await until(
      async () => (await one.updates()).length > before,
      timing.updateWindowMs,
    );
    step("r5-changed", { version: v5.json.version?.versionNumber ?? null, updated });
    await throttled();
    await one.call("unlisten");
  } catch (error) {
    result.stopped =
      error instanceof Stop || error instanceof Unknown ? error.message : `error: ${error.message}`;
  } finally {
    // ---- G. restoration ----
    for (const [name, client] of Object.entries(clients)) {
      try {
        await client.call("unlisten");
        result.clients[name] = {
          ...result.clients[name],
          updates: await client.updates(),
          deletion: await client.call("deleteInstallation"),
        };
        if (!result.clients[name].deletion.deleted)
          result.open.push(`g-${name}: installation not deleted (unreadable afterwards; residue)`);
        result.clients[name].wire = await client.wire();
      } catch (error) {
        result.open.push(`g-${name}: ${error.message}`);
      }
    }
    if (base) {
      try {
        let r = await t.send("g-client", urls.client);
        if (r.status === 200 && !isEmpty(r.json) && wrote) {
          await pace();
          await t.send("g-restore", `${urls.client}:rollback`, {
            method: "POST",
            body: { versionNumber: base.version },
          });
          lastWrite = Date.now();
          r = await t.send("g-client-after", urls.client);
        }
        result.baseline.after = {
          status: r.status,
          empty: r.status === 200 && isEmpty(r.json),
          version: r.json?.version?.versionNumber ?? null,
        };
      } catch (error) {
        result.open.push(`g-client: ${error.message}`);
      }
    }
    // A create whose operation was not settled is polled again; a key it names is deleted.
    if (ctx.production && !keyName && createOperation) {
      try {
        const done = await operation("g-create", createOperation, timing.polls);
        if (done && !done.error && done.response?.name) keyName = grantKey(done.response.name);
      } catch (error) {
        result.open.push(`g-create: ${error.message}`);
      }
    }
    if (ctx.production && keyName) {
      const problem = await deleteKey(keyName);
      if (problem) result.open.push(`${problem} (A2 lists keys)`);
      else result.open.splice(result.open.indexOf(KEY_OPEN), 1);
    } else if (ctx.production && result.key.createRequested && !keyName) result.key.deleted = false;
  }
  keyValue = null;
  result.sandboxAtBaseline =
    result.baseline.after?.empty === true &&
    result.open.length === 0 &&
    (!ctx.production || result.key.deleted !== false);
  result.unknown = [...t.unknown];
  result.adminRequests = t.count;
  result.pageRequests = browser.allowedRequests();
  result.cleanupRequests = browser.cleanupRequests?.() ?? 0;
  result.refusals = browser.refusals;
  result.complete =
    result.stopped === null &&
    result.sandboxAtBaseline &&
    result.unknown.length === 0 &&
    browser.refusals.length === 0;
  return result;
}
