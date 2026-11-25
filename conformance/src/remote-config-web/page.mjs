// The browser page of the RC-CLOSURE-B recorder: the pinned Web SDK (firebase 12.18.0) in one
// Chromium context, driven by the recorder through `window.rc`. Every fetch the SDK makes is
// recorded here, masked before it leaves the page: the API key, the Installation id and every
// Installations credential never reach the recorder.
//
// The page reads its input from `window.__RC_INPUT` ({ config, sdk }), set by the recorder before
// the page's scripts run. `sdk` is the base URL the bundles are served from.
const input = window.__RC_INPUT;
const { config } = input;
const KEY = config.apiKey;

/** Hosts whose exchanges are recorded with their bodies (Installations: masked layouts only). */
const RC_HOSTS = new Set([
  "firebaseremoteconfig.googleapis.com",
  "firebaseremoteconfigrealtime.googleapis.com",
]);
const INSTALLATIONS = "firebaseinstallations.googleapis.com";

const labels = new Map();
/** A stable label for a secret value within the page: `FID_1`, `TOKEN_2`, ... */
const label = (kind, value) => {
  if (typeof value !== "string" || value === "") return value;
  const key = `${kind}|${value}`;
  if (!labels.has(key))
    labels.set(
      key,
      `${kind}_${[...labels.keys()].filter((k) => k.startsWith(`${kind}|`)).length + 1}`,
    );
  return labels.get(key);
};
const secrets = () =>
  [...labels.keys()].map((key) => [key.slice(key.indexOf("|") + 1), labels.get(key)]);

/** Replaces the key and every labelled secret in a text; longest values first. */
export function maskText(text) {
  if (typeof text !== "string") return text;
  let out = KEY ? text.split(KEY).join("API_KEY") : text;
  for (const [value, name] of secrets().toSorted((a, b) => b[0].length - a[0].length))
    out = out.split(value).join(name);
  return out;
}

/** The layout of a JSON value with every string replaced by its length (Installations bodies). */
export function layoutOf(value) {
  if (Array.isArray(value)) return value.map(layoutOf);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, layoutOf(v)]));
  if (typeof value === "string") return `string:${value.length}`;
  return value;
}

/** Learns the secrets of an Installations answer or a fetch request before anything is masked. */
function learn(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.fid === "string") label("FID", value.fid);
  if (typeof value.refreshToken === "string") label("REFRESH", value.refreshToken);
  if (typeof value.authToken?.token === "string") label("TOKEN", value.authToken.token);
  if (typeof value.token === "string") label("TOKEN", value.token);
  if (typeof value.app_instance_id === "string") label("FID", value.app_instance_id);
  if (typeof value.app_instance_id_token === "string") label("TOKEN", value.app_instance_id_token);
  if (typeof value.appInstanceId === "string") label("FID", value.appInstanceId);
}

const HEADERS = new Set([
  "content-type",
  "content-encoding",
  "if-none-match",
  "etag",
  "accept",
  "x-goog-api-key",
  "x-goog-firebase-installations-auth",
  "x-firebase-rc-fetch-type",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "cache-control",
  "vary",
  "transfer-encoding",
]);
const headersOf = (headers) =>
  Object.fromEntries(
    [...headers.entries()]
      .filter(([name]) => HEADERS.has(name.toLowerCase()))
      .map(([name, value]) => {
        const lower = name.toLowerCase();
        if (lower === "x-goog-firebase-installations-auth") return [lower, label("TOKEN", value)];
        if (lower.startsWith("x-goog-api-key"))
          return [lower, value === KEY ? "API_KEY" : "OTHER_KEY"];
        return [lower, value];
      }),
  );

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const wire = [];
let sequence = 0;
const started = performance.now();
const realFetch = window.fetch.bind(window);

window.fetch = async (resource, init) => {
  const request = new Request(resource, init);
  const url = new URL(request.url);
  const n = (sequence += 1);
  const bodyText = request.method === "GET" ? "" : await request.clone().text();
  const requestJson = parse(bodyText);
  learn(requestJson);
  // The exchange is recorded when the request is sent; its answer fills it in (a realtime stream
  // may answer only when a version is published).
  const entry = {
    n,
    at: Math.round(performance.now() - started),
    host: url.host,
    method: request.method,
    path: maskText(url.pathname),
    query: maskText(url.search),
    requestHeaders: headersOf(request.headers),
    status: null,
  };
  const recorded = RC_HOSTS.has(url.host);
  if (url.host === INSTALLATIONS) entry.requestLayout = layoutOf(requestJson ?? null);
  else if (recorded) entry.requestBody = maskText(bodyText);
  wire.push(entry);
  let response;
  try {
    response = await realFetch(request);
  } catch (error) {
    entry.error = error?.name ?? "error";
    throw error;
  }
  entry.answeredAt = Math.round(performance.now() - started);
  entry.status = response.status;
  entry.responseHeaders = headersOf(response.headers);
  if (url.host === INSTALLATIONS) {
    const text = await response.clone().text();
    const json = parse(text);
    learn(json);
    entry.responseLayout = layoutOf(json ?? null);
    entry.responseBytes = text.length;
    return response;
  }
  if (!recorded) return response;
  if (url.pathname.endsWith(":streamFetchInvalidations") && response.body) {
    // The stream is read here frame by frame (chunk by chunk, with its arrival time) while the SDK
    // reads its own copy.
    const [own, copy] = response.body.tee();
    entry.chunks = [];
    (async () => {
      const reader = copy.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          entry.chunks.push({
            at: Math.round(performance.now() - started),
            text: maskText(decoder.decode(value, { stream: true })),
          });
        }
        entry.ended = "done";
      } catch (error) {
        entry.ended = `error:${error?.name ?? "error"}`;
      }
    })();
    return new Response(own, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  entry.responseBody = maskText(await response.clone().text());
  return response;
};

const { initializeApp } = await import(`${input.sdk}firebase-app.js`);
const rcModule = await import(`${input.sdk}firebase-remote-config.js`);
const installationsModule = await import(`${input.sdk}firebase-installations.js`);
const app = initializeApp(config);
const remoteConfig = rcModule.getRemoteConfig(app);
remoteConfig.settings.minimumFetchIntervalMillis = 0;
remoteConfig.settings.fetchTimeoutMillis = 30_000;
let subscription = null;
const updates = [];

window.rc = {
  /** Sets the custom signals, fetches, activates; returns the values and their sources. */
  async fetch(signals) {
    await rcModule.setCustomSignals(remoteConfig, signals ?? {});
    let activated = null;
    let error = null;
    try {
      activated = await rcModule.fetchAndActivate(remoteConfig);
    } catch (caught) {
      error = caught?.code ?? caught?.name ?? "error";
    }
    const values = Object.fromEntries(
      Object.entries(rcModule.getAll(remoteConfig)).map(([key, value]) => [
        key,
        { value: value.asString(), source: value.getSource() },
      ]),
    );
    return { activated, error, values, lastFetchStatus: remoteConfig.lastFetchStatus };
  },
  /** Opens the realtime listener; updates are kept with the keys they name. */
  listen() {
    subscription = rcModule.onConfigUpdate(remoteConfig, {
      next: (update) =>
        updates.push({
          at: Math.round(performance.now() - started),
          keys: [...update.getUpdatedKeys()].toSorted(),
        }),
      error: (error) =>
        updates.push({
          at: Math.round(performance.now() - started),
          error: error?.code ?? "error",
        }),
      complete: () => updates.push({ at: Math.round(performance.now() - started), complete: true }),
    });
    return true;
  },
  unlisten() {
    subscription?.();
    subscription = null;
    return true;
  },
  updates: () => structuredClone(updates),
  /** The recorded exchanges since `from` (every value already masked). */
  wire: (from = 0) => structuredClone(wire.slice(from)),
  /** Deletes this context's installation through the SDK (the recorded DELETE). */
  async deleteInstallation() {
    try {
      await installationsModule.deleteInstallations(installationsModule.getInstallations(app));
      return { deleted: true };
    } catch (caught) {
      return { deleted: false, error: caught?.code ?? caught?.name ?? "error" };
    }
  },
};
window.rcReady = true;
