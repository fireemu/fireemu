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
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The published empty baseline, in the one shape production records for it (send-b-2 g-client):
 * an object whose only member is `version`, with a decimal versionNumber (ruling 18 item 6). Phase
 * A, G and A2 accept exactly this; `200 {}` (unpublished) or any content is not the baseline.
 */
export function baselineEmpty(doc) {
  return (
    isObject(doc) &&
    Object.keys(doc).every((k) => k === "version") &&
    isObject(doc.version) &&
    typeof doc.version.versionNumber === "string" &&
    /^[1-9][0-9]*$/.test(doc.version.versionNumber)
  );
}

/** A deletion time as the API Keys service writes it: RFC 3339 in UTC, never empty. */
export const DELETE_TIME =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$/;
/** Whether a string is a real instant in that form: the calendar fields are checked (ruling 19). */
export function isInstant(text) {
  const m = typeof text === "string" ? DELETE_TIME.exec(text) : null;
  if (!m) return false;
  const [y, mo, d, h, mi, sec] = text.slice(0, 19).split(/[-T:]/).map(Number);
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  return (
    at.getUTCFullYear() === y &&
    at.getUTCMonth() === mo - 1 &&
    at.getUTCDate() === d &&
    at.getUTCHours() === h &&
    at.getUTCMinutes() === mi &&
    at.getUTCSeconds() === sec
  );
}
export const isDeleted = (key) => isInstant(key?.deleteTime);

/**
 * A definite refusal of the key create (ruling 19 item 5): a 4xx whose body is Google's error
 * object for that status. It settles "no key was created"; anything else does not.
 */
/** The definite refusals of a create; a 408 or 499 is a lost answer, never a refusal (ruling 20). */
export const CREATE_REFUSALS = new Set([400, 401, 403, 404, 409, 429]);
export const createRefused = (r) =>
  CREATE_REFUSALS.has(r.status) &&
  isObject(r.json?.error) &&
  r.json.error.code === r.status &&
  typeof r.json.error.status === "string" &&
  typeof r.json.error.message === "string";

/**
 * A complete read: 200, a JSON object without an `error` member and without a nextPageToken
 * (ruling 18 item 6). Everything else is refused with `what`.
 */
export function completeRead(r, what) {
  if (r.status !== 200 || !isObject(r.json) || "error" in r.json || "nextPageToken" in r.json)
    throw new Stop(`${what} not complete (${r.status})`);
  return r.json;
}

/**
 * The page-side statuses a forward step may continue after (ruling 18 item 1): an answer of 200,
 * a 304 to a fetch, a request not answered yet, and a realtime request the SDK aborted when its
 * listener closed. Any other status (403, 429 included), any other failed request, and any error
 * the listener reported stop the forward program.
 */
export function pageProblem(wire, updates) {
  for (const e of wire) {
    const stream = (e.path ?? "").endsWith(":streamFetchInvalidations");
    if (e.error !== undefined && !(stream && e.error === "AbortError"))
      return `${e.host} request failed (${e.error})`;
    // A stream whose body ended with an error other than the listener's own close (ruling 19).
    if (
      stream &&
      typeof e.ended === "string" &&
      e.ended.startsWith("error:") &&
      e.ended !== "error:AbortError"
    )
      return `${e.host} stream ended with ${e.ended.slice("error:".length)}`;
    if (e.status === null || e.status === undefined) continue;
    if (e.status === 200) continue;
    if (e.status === 304 && (e.path ?? "").endsWith(":fetch")) continue;
    if (e.status >= 200 && e.status < 300 && e.method === "DELETE") continue;
    return `${e.host} answered ${e.status}`;
  }
  const failed = (updates ?? []).find((u) => u.error !== undefined);
  return failed ? `the listener reported ${failed.error}` : null;
}

/**
 * Runs one pass. `ctx`: { transport, urls: {client, services, webApps, keys}, project, number,
 * browser (driver.openBrowser), runId, timing, wait?, production: boolean }.
 */
export async function observe(ctx) {
  const { transport: t, urls, runId, timing, browser } = ctx;
  const wait = ctx.wait ?? sleep;
  const result = { runId, stopped: null, open: [], steps: [], baseline: {}, key: {}, clients: {} };
  // An admin 403 or 429 stops the hook as soon as its headers arrive, before its body is read and
  // before the forward program sees it (ruling 20); G's own reads are not forward work.
  let restoring = false;
  t.onStatus = (caseId, status) => {
    if (!restoring && (status === 403 || status === 429))
      browser.stop(`${caseId} answered ${status}`);
  };
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
    await gate();
    try {
      const r = await t.send(caseId, url, {
        method,
        body,
        ifMatch,
        beforeDispatch: () => {
          if (browser.stopped()) throw new Stop(`browser: ${browser.stopped()}`);
          wrote = true;
        },
      });
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
      // The operation's own answer: 200, an object naming the operation read.
      if (op.status !== 200 || !isObject(op.json) || op.json.name !== name)
        throw new Stop(`${prefix}: operation read ${op.status}`);
      if (op.json.done === true) return op.json;
      await wait(timing.pollMs);
    }
    return null;
  };
  /**
   * The forward gate (ruling 18 item 1), before every template write, after every page call and
   * on every turn of a wait: a stopped hook, or any page-side answer outside `pageProblem`'s
   * closed set, stops the forward program; G still runs.
   */
  const gate = async () => {
    if (browser.stopped()) throw new Stop(`browser: ${browser.stopped()}`);
    for (const [name, client] of Object.entries(clients)) {
      const problem = pageProblem(await client.wire(), await client.updates());
      if (problem) throw new Stop(`page ${name}: ${problem}`);
    }
  };
  /** Waits until `done()` or the window ends; returns whether it happened. */
  const until = async (done, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await gate();
      if (await done()) return true;
      await wait(500);
    }
    await gate();
    return false;
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
      if (deleted.status !== 200 || !isObject(deleted.json)) return `k-delete: ${deleted.status}`;
      const done = await operation("k-delete", deleted.json.name);
      if (!done || done.error) return "k-delete: operation not done without error";
      // Two accepted proofs (ruling 19 item 5): the done operation's response is the key with a
      // real deleteTime, or the read-back of the key's own name is. Any other shape proves nothing.
      const proves = (key) => isObject(key) && key.name === name && isDeleted(key);
      result.key.deletedBy = proves(done.response) ? ["operation"] : [];
      let live = false;
      try {
        const back = await t.send("k-readback", `${urls.keysApi}${name}`, { secret: true });
        result.key.readback = back.status;
        if (back.status === 200 && proves(back.json)) result.key.deletedBy.push("read-back");
        // A 200 naming the key without a real deleteTime shows it live: that contradicts the
        // operation and proves nothing (ruling 20).
        live =
          back.status === 200 &&
          isObject(back.json) &&
          back.json.name === name &&
          !isDeleted(back.json);
      } catch (error) {
        result.key.readback = error.message;
      }
      if (live) result.key.readbackLive = true;
      result.key.deleted = !live && result.key.deletedBy.length > 0;
      if (live) return "k-readback: the key reads live after its deletion";
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
    // Every read is judged by its shape, not only its status (ruling 18 item 6).
    const a = await t.send("a-client", urls.client);
    if (a.status !== 200 || !baselineEmpty(a.json))
      throw new Stop("the client template is not at the published empty baseline");
    base = { version: a.json.version.versionNumber, etag: a.etag };
    result.baseline.before = { version: base.version, empty: true };
    if (ctx.production) {
      // The three APIs, each ENABLED, named under the configured project number: the number is
      // compared with the provider's before the key is created.
      const services = completeRead(await t.send("a-services", urls.services), "services");
      const listed = Array.isArray(services.services) ? services.services : [];
      const named = new Map(listed.map((x) => [x?.name, x]));
      result.baseline.services = Object.fromEntries(
        API_TARGETS.map((x) => [
          x,
          named.get(`projects/${ctx.number}/services/${x}`)?.state ?? null,
        ]),
      );
      if (
        listed.length !== API_TARGETS.length ||
        !API_TARGETS.every(
          (x) => named.get(`projects/${ctx.number}/services/${x}`)?.state === "ENABLED",
        )
      )
        throw new Stop("a required API is not ENABLED under the configured project number");
      const apps = completeRead(await t.send("a-web-apps", urls.webApps), "web apps list");
      const matching = (Array.isArray(apps.apps) ? apps.apps : []).filter(
        (x) => x?.displayName === WEB_APP,
      );
      const appNumber = /^1:([0-9]+):web:[0-9a-f]+$/.exec(matching[0]?.appId ?? "")?.[1];
      if (matching.length !== 1 || !appNumber) throw new Stop(`web app ${WEB_APP} not found`);
      if (appNumber !== ctx.number)
        throw new Stop("the configured project number is not the provider's");
      ctx.appId = matching[0].appId;
      const keys = completeRead(await t.send("a-keys", urls.keysList), "key list");
      if (keys.keys !== undefined && !Array.isArray(keys.keys))
        throw new Stop("key list not complete (200)");
      if ((keys.keys ?? []).some((k) => !isObject(k) || typeof k.name !== "string"))
        throw new Stop("key list not complete (200)");
      if ((keys.keys ?? []).some((k) => k.displayName === KEY_ID && !isDeleted(k)))
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
      if (createRefused(created)) {
        // Positive evidence that nothing was created: the item is settled here.
        result.key.createRefused = created.status;
        result.open.splice(result.open.indexOf(KEY_OPEN), 1);
        throw new Stop(`k-create: refused ${created.status}`);
      }
      if (created.status !== 200 || !isObject(created.json))
        throw new Stop(`k-create: ${created.status}`);
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
    // The recorder's leak check holds the value until its outputs are written (ruling 18 item 3).
    ctx.secrets?.add(keyValue);
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
    clients.one = await browser.client(config, "one");
    clients.two = await browser.client(config, "two");
    for (const [name, signals] of [
      ["one", SIGNALS.s1],
      ["two", SIGNALS.s2],
    ]) {
      const fetches = [];
      result.clients[name] = { fetches };
      for (const _ of [1, 2]) {
        await gate();
        const f = await clients[name].call("fetch", signals);
        fetches.push(f);
        await gate();
        // Only a successful fetch lets the forward program go on (a throttle, a failure or an
        // error the SDK returned instead of throwing stops it).
        if (f.lastFetchStatus !== "success" || f.error !== null)
          throw new Stop(`f-${name}: ${f.lastFetchStatus}${f.error ? ` (${f.error})` : ""}`);
      }
      step(`f-${name}`, { first: fetches[0].lastFetchStatus, again: fetches[1].lastFetchStatus });
    }

    // ---- R. realtime on installation one ----
    const one = clients.one;
    await gate();
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
    }
    // One reconnect: the listener closed and opened again, then one more changed publication.
    await gate();
    await one.call("unlisten");
    await wait(timing.reconnectGapMs);
    await gate();
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
    await one.call("unlisten");
  } catch (error) {
    result.stopped =
      error instanceof Stop || error instanceof Unknown ? error.message : `error: ${error.message}`;
    // A forward stop from any side stops the hook too: the SDK's own requests are refused from
    // here on, the installations' deletions keep their reserve (ruling 19 item 1).
    browser.stop(`forward program stopped: ${result.stopped}`);
  } finally {
    restoring = true;
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
    // An installation whose create the hook dispatched is settled only by a DELETE answered 2xx
    // on the wire (ruling 18 item 5); the SDK's own resolution never settles it.
    try {
      for (const proof of await browser.installations()) {
        result.installations = [...(result.installations ?? []), proof];
        if (proof.proved !== proof.dispatched)
          result.open.push(
            `g-${proof.name}: installation deletion not proved on the wire (${proof.proved} of ${proof.dispatched})`,
          );
      }
    } catch (error) {
      result.open.push(`g-installations: ${error.message}`);
    }
    if (base) {
      try {
        let r = await t.send("g-client", urls.client);
        if (!(r.status === 200 && baselineEmpty(r.json)) && wrote) {
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
          empty: r.status === 200 && baselineEmpty(r.json),
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
      else if (result.open.includes(KEY_OPEN)) result.open.splice(result.open.indexOf(KEY_OPEN), 1);
    } else if (
      ctx.production &&
      result.key.createRequested &&
      !keyName &&
      !result.key.createRefused
    )
      result.key.deleted = false;
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
