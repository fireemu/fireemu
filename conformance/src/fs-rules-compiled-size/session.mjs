// Observer session for FS-9. It creates rulesets (never releases) on the sandbox project,
// records accept or refuse with the exact error body per ruleset, deletes what it created,
// and flags the run unless the project's rulesets and releases end exactly as they began.
// Every request passes one guard: fixed host, fixed project, four allowed request shapes, a
// request cap, a timeout, no redirects, no retries.
import { createHash } from "node:crypto";

export const ALLOWED_HOST = "firebaserules.googleapis.com";
export const SANDBOX_PROJECT = "fireemu-oracle-sbx";
export const MAX_LIST_PAGES = 2;
export const LIST_PAGE_SIZE = 100;
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Settling strays must have been created no earlier than this long before the run started. */
export const STRAY_SKEW_MS = 120_000;

const BASE_PATH = `/v1/projects/${SANDBOX_PROJECT}`;
const NAME_PATTERN = /^projects\/fireemu-oracle-sbx\/rulesets\/[A-Za-z0-9_-]{1,128}$/;
const NAME_IN_TEXT = /projects\/fireemu-oracle-sbx\/rulesets\/[A-Za-z0-9_-]{1,128}/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{8,4096}$/;
const MAX_STRING = 4000;

/**
 * Two list passes plus a settle pass of up to MAX_LIST_PAGES pages each, two release reads,
 * one create and at most one delete per rung, and one slack request.
 */
export const requestCapFor = (rungCount) => 2 + 3 * MAX_LIST_PAGES + 2 * rungCount + 1;

export class RefusedRequest extends Error {}
export class RequestCapReached extends Error {}

export function maskText(text) {
  return String(text).replace(/\d{12,}/g, "<NUMBER>");
}

function maskDeep(value) {
  if (typeof value === "string") {
    const masked = maskText(value);
    return masked.length > MAX_STRING
      ? `${masked.slice(0, MAX_STRING)}...[truncated, ${masked.length} chars]`
      : masked;
  }
  if (typeof value === "number")
    return /^\d{12,}$/.test(String(Math.abs(value))) ? "<NUMBER>" : value;
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskDeep(item)]));
  }
  return value;
}

const canonicalJson = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  );

/** The only constructors of request URLs. */
export const urls = Object.freeze({
  listRulesets: (pageToken) => {
    const query = new URLSearchParams({ pageSize: String(LIST_PAGE_SIZE) });
    if (pageToken) query.set("pageToken", pageToken);
    return `https://${ALLOWED_HOST}${BASE_PATH}/rulesets?${query}`;
  },
  createRuleset: () => `https://${ALLOWED_HOST}${BASE_PATH}/rulesets`,
  listReleases: () => `https://${ALLOWED_HOST}${BASE_PATH}/releases`,
  deleteRuleset: (name) => `https://${ALLOWED_HOST}/v1/${name}`,
});

/**
 * The guarded client. `deletable` is the set of ruleset names this run may delete: names a
 * create returned, and strays the run attributed to its own unknown creates.
 */
export function createGuardedClient({
  fetchImpl,
  token,
  project,
  cap,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (project !== SANDBOX_PROJECT) throw new RefusedRequest("project must be the sandbox project");
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new RefusedRequest("a bearer token is required");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!Number.isInteger(cap) || cap < 1) throw new RangeError("cap must be a positive integer");
  const deletable = new Set();
  const protectedNames = new Set();
  const state = { count: 0, echoed: false };

  function check({ method, url }) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new RefusedRequest("malformed URL");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.host !== ALLOWED_HOST ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new RefusedRequest("host is not allowed");
    }
    const { pathname, searchParams } = parsed;
    if (method === "GET" && pathname === `${BASE_PATH}/releases` && parsed.search === "") return;
    if (method === "GET" && pathname === `${BASE_PATH}/rulesets`) {
      const keys = [...searchParams.keys()];
      const size = searchParams.get("pageSize");
      const page = searchParams.get("pageToken");
      if (
        keys.some((key) => key !== "pageSize" && key !== "pageToken") ||
        new Set(keys).size !== keys.length ||
        size !== String(LIST_PAGE_SIZE) ||
        (page !== null && !/^[A-Za-z0-9_=+/.-]{1,2048}$/.test(page))
      ) {
        throw new RefusedRequest("rulesets list query is not allowed");
      }
      return;
    }
    if (method === "POST" && pathname === `${BASE_PATH}/rulesets` && parsed.search === "") return;
    if (method === "DELETE" && parsed.search === "" && pathname.startsWith("/v1/")) {
      const name = pathname.slice(4);
      if (NAME_PATTERN.test(name) && deletable.has(name) && !protectedNames.has(name)) return;
      throw new RefusedRequest("delete target was not created by this run");
    }
    throw new RefusedRequest(`${method} ${pathname} is not an allowed request`);
  }

  async function send({ method, url, body }) {
    check({ method, url });
    if (state.count >= cap) throw new RequestCapReached(`request cap ${cap} reached`);
    state.count += 1;
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout" });
      }, timeoutMs);
    });
    const exchange = (async () => {
      try {
        const response = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "x-goog-user-project": project,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
          signal: controller.signal,
        });
        const status = Number(response.status);
        let text = "";
        let readable = true;
        try {
          text = await response.text();
        } catch {
          readable = false;
        }
        return { kind: "response", status, text, readable };
      } catch {
        return { kind: "network" };
      }
    })();
    const raw = await Promise.race([exchange, timeout]);
    clearTimeout(timer);
    if (raw.kind !== "response") return { kind: raw.kind, status: null, json: null, text: "" };
    if (raw.text.includes(token)) {
      state.echoed = true;
      const hint = raw.text.match(NAME_IN_TEXT);
      return {
        kind: "response",
        status: raw.status,
        json: null,
        text: "",
        echoed: true,
        nameHint: hint?.[0] ?? null,
      };
    }
    let json = null;
    if (raw.readable && raw.text !== "") {
      try {
        json = JSON.parse(raw.text);
      } catch {
        json = null;
      }
    }
    return { kind: "response", status: raw.status, json, text: "", unreadable: json === null };
  }

  return {
    send,
    authorizeDelete: (name) => {
      if (!NAME_PATTERN.test(name) || protectedNames.has(name))
        throw new RefusedRequest("name not deletable");
      deletable.add(name);
    },
    protect: (names) => {
      for (const name of names) {
        protectedNames.add(name);
        deletable.delete(name);
      }
    },
    get count() {
      return state.count;
    },
    get echoed() {
      return state.echoed;
    },
    cap,
  };
}

const isUnknownStatus = (status) =>
  status < 200 ||
  (status >= 300 && status < 400) ||
  status >= 500 ||
  status === 408 ||
  status === 429;

function describeError(json) {
  const error = json && typeof json === "object" ? json.error : undefined;
  const body = maskDeep(json);
  return {
    errorCode: typeof error?.code === "number" ? error.code : null,
    errorStatus: typeof error?.status === "string" ? maskText(error.status) : null,
    errorMessage: typeof error?.message === "string" ? maskDeep(error.message) : null,
    body,
  };
}

function classifyCreate(res) {
  if (res.echoed) return { kind: "echo" };
  if (res.kind !== "response") return { kind: "unknown", why: res.kind };
  if (isUnknownStatus(res.status)) return { kind: "unknown", why: `status-${res.status}` };
  if (res.unreadable) return { kind: "unknown", why: "unreadable-body" };
  if (res.status === 401 || res.status === 403) return { kind: "credential" };
  if (res.status >= 200 && res.status < 300) {
    const name = res.json?.name;
    return typeof name === "string" && NAME_PATTERN.test(name)
      ? { kind: "accepted", name }
      : { kind: "unknown", why: "success-without-name" };
  }
  return { kind: "refused" };
}

/** Reads every page of the rulesets list; never settles on absence or a failed read. */
async function listAll(client) {
  const names = new Map();
  let token;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const res = await client.send({ method: "GET", url: urls.listRulesets(token) });
    if (res.kind !== "response" || res.status < 200 || res.status >= 300 || !res.json) {
      return { ok: false, names, truncated: false };
    }
    const entries = res.json.rulesets ?? [];
    if (!Array.isArray(entries)) return { ok: false, names, truncated: false };
    for (const entry of entries) {
      if (typeof entry?.name !== "string" || !NAME_PATTERN.test(entry.name)) {
        return { ok: false, names, truncated: false };
      }
      names.set(
        entry.name,
        typeof entry.createTime === "string" ? Date.parse(entry.createTime) : Number.NaN,
      );
    }
    token = res.json.nextPageToken;
    if (!token) return { ok: true, names, truncated: false };
  }
  return { ok: false, names, truncated: true };
}

async function readReleases(client) {
  const res = await client.send({ method: "GET", url: urls.listReleases() });
  if (res.kind !== "response" || res.status < 200 || res.status >= 300 || !res.json) return null;
  return canonicalJson(res.json);
}

const sha = (text) => createHash("sha256").update(text).digest("hex");
const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item));

export async function runObserver({
  fetchImpl,
  token,
  project,
  rungs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
}) {
  if (!Array.isArray(rungs) || rungs.length === 0) throw new TypeError("rungs are required");
  const cap = requestCapFor(rungs.length);
  const client = createGuardedClient({ fetchImpl, token, project, cap, timeoutMs });
  const startedAt = now();
  const rows = rungs.map((rung) => ({
    id: rung.id,
    kind: rung.kind,
    byteLength: rung.byteLength,
    leafCount: rung.leafCount,
    sha256: rung.sha256,
    outcome: "not-attempted",
    transport: null,
    status: null,
    errorCode: null,
    errorStatus: null,
    errorMessage: null,
    body: null,
    namePresent: false,
    cleanup: "none",
  }));
  const created = new Map();
  const unknownRows = [];
  const flags = [];
  let stop = null;
  const halt = (reason) => {
    stop ??= reason;
  };
  const guarded = async (step) => {
    try {
      return await step();
    } catch (error) {
      if (error instanceof RequestCapReached) halt("request-cap");
      else halt(`internal-error:${error?.constructor?.name ?? "Error"}`);
      return undefined;
    }
  };
  const result = () => {
    const unconfirmed = unknownRows.filter((row) => row.cleanup === "unconfirmed");
    const failedDeletes = rows.filter((row) => row.cleanup === "delete-failed");
    const everyAttempted = rows.every((row) => row.outcome !== "not-attempted");
    const complete =
      stop === null &&
      everyAttempted &&
      unconfirmed.length === 0 &&
      failedDeletes.length === 0 &&
      flags.length === 0 &&
      !client.echoed;
    return {
      project,
      complete,
      exitCode: complete ? 0 : 1,
      stop,
      flags,
      requestCount: client.count,
      requestCap: cap,
      createdNames: [...created.keys()],
      unconfirmed: unconfirmed.map((row) => row.id),
      rows,
    };
  };

  const releasesBefore = await guarded(() => readReleases(client));
  if (releasesBefore === undefined || releasesBefore === null) {
    flags.push("baseline-releases-unavailable");
    halt("baseline-unavailable");
    return result();
  }
  const baseline = await guarded(() => listAll(client));
  if (!baseline?.ok) {
    flags.push("baseline-list-unavailable");
    halt("baseline-unavailable");
    return result();
  }
  const baselineNames = new Set(baseline.names.keys());
  client.protect(baselineNames);

  for (const [index, rung] of rungs.entries()) {
    if (stop !== null) break;
    const row = rows[index];
    const res = await guarded(() =>
      client.send({
        method: "POST",
        url: urls.createRuleset(),
        body: { source: { files: [{ name: "firestore.rules", content: rung.source }] } },
      }),
    );
    if (res === undefined) break;
    row.transport = res.kind;
    row.status = res.status;
    const verdict = classifyCreate(res);
    if (verdict.kind === "echo") {
      row.outcome = "unknown";
      halt("token-echo");
      if (res.status >= 200 && res.status < 300 && res.nameHint) {
        created.set(res.nameHint, row);
        row.namePresent = true;
        row.cleanup = "pending";
        client.authorizeDelete(res.nameHint);
      } else {
        row.cleanup = "unconfirmed";
        unknownRows.push(row);
      }
    } else if (verdict.kind === "accepted") {
      Object.assign(row, { outcome: "accepted", namePresent: true, cleanup: "pending" });
      created.set(verdict.name, row);
      client.authorizeDelete(verdict.name);
    } else if (verdict.kind === "refused") {
      Object.assign(row, { outcome: "refused", ...describeError(res.json) });
    } else if (verdict.kind === "credential") {
      Object.assign(row, { outcome: "credential-stop", ...describeError(res.json) });
      halt(`credential-${res.status}`);
    } else {
      Object.assign(row, { outcome: "unknown", cleanup: "unconfirmed", why: verdict.why });
      unknownRows.push(row);
    }
  }

  const deleteOne = async (name, row, settled) => {
    const res = await guarded(() =>
      client.send({ method: "DELETE", url: urls.deleteRuleset(name) }),
    );
    if (res === undefined) {
      row.cleanup = "delete-failed";
      return "failed";
    }
    if (res.kind === "response" && res.status >= 200 && res.status < 300) {
      row.cleanup = settled ?? "deleted";
      return "ok";
    }
    if (res.kind === "response" && res.status === 404 && !settled) {
      row.cleanup = "absent";
      return "ok";
    }
    row.cleanup = "delete-failed";
    row.deleteStatus = res.status;
    return res.status === 401 || res.status === 403 ? "credential" : "failed";
  };

  let deleteBlocked = false;
  for (const [name, row] of created) {
    if (deleteBlocked) {
      row.cleanup = "delete-failed";
      continue;
    }
    const outcome = await deleteOne(name, row);
    if (outcome === "credential") {
      deleteBlocked = true;
      halt("credential-on-delete");
    }
  }

  let finalList = await guarded(() => listAll(client));
  if (unknownRows.length > 0 && finalList?.ok) {
    const own = new Set(created.keys());
    const strays = [...finalList.names]
      .filter(
        ([name, time]) =>
          !baselineNames.has(name) && !own.has(name) && time >= startedAt - STRAY_SKEW_MS,
      )
      .toSorted(([, a], [, b]) => a - b);
    if (strays.length === unknownRows.length && !deleteBlocked) {
      let touched = false;
      for (const [index, [name]] of strays.entries()) {
        client.authorizeDelete(name);
        const outcome = await deleteOne(name, unknownRows[index], "settled-by-list");
        touched = true;
        if (outcome === "credential") {
          deleteBlocked = true;
          halt("credential-on-delete");
          break;
        }
      }
      if (touched) finalList = await guarded(() => listAll(client));
    } else if (strays.length > 0) {
      flags.push(`ambiguous-strays:${strays.length}`);
    }
  }
  for (const row of unknownRows) {
    if (row.cleanup === "unconfirmed") flags.push(`unconfirmed-create:${row.id}`);
  }
  for (const row of rows) {
    if (row.cleanup === "delete-failed") flags.push(`delete-failed:${row.id}`);
  }
  if (!finalList?.ok) flags.push("final-list-unavailable");
  else if (!sameSet(new Set(finalList.names.keys()), baselineNames))
    flags.push("baseline-mismatch");

  const releasesAfter = await guarded(() => readReleases(client));
  if (releasesAfter === undefined || releasesAfter === null)
    flags.push("final-releases-unavailable");
  else if (releasesAfter !== releasesBefore) flags.push("releases-changed");
  if (client.echoed) flags.push("token-echo");
  return {
    ...result(),
    baselineCount: baselineNames.size,
    baselineSha256: sha([...baselineNames].toSorted().join("\n")),
  };
}
