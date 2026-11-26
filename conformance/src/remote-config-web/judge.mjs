// The RC-CLOSURE-B judge: compares two fixtures of the Web client pass (sanitise.mjs), production
// to production (run to run) or a local fireemu run to a production pass, row by row.
//
// Rows, in order: the pass's steps; per context every exchange of the page, aligned by position
// (Installations creates and deletes, fetches, the realtime stream), the SDK's fetch results and
// the listener's updates. Versions are compared as offsets from each pass's baseline (the client
// template's version before the pass), so 47 in pass 1 and 54 in pass 2 are both +1. Times are
// not compared (the fixtures keep the order only).
//
// Verdicts: MATCH (equal after the version offsets), MATCH_LAYOUT (equal in form where the values
// are not comparable: production's tags and Installations credentials), KNOWN_DIFFERENCE (a
// declared difference of known-differences.json, named), MISMATCH, UNKNOWN (a side is missing).
import { readFileSync } from "node:fs";

export const KNOWN = JSON.parse(
  readFileSync(new URL("./known-differences.json", import.meta.url), "utf8"),
);
const kd = (id) => {
  if (!KNOWN.some((k) => k.id === id)) throw new Error(`unknown known difference ${id}`);
  return id;
};

const VERSION =
  /("(?:templateVersion|latestTemplateVersionNumber|lastKnownVersionNumber)":\s*")([0-9]+)(")/g;
const TAG = /^etag-PROJECT_ID-firebase-fetch-(-?(?:0|[1-9][0-9]*))$/;
const fetchTag = (value) => {
  const number = Number(TAG.exec(value ?? "")?.[1]);
  return number >= -2147483648 && number <= 2147483647;
};

/** A text with every recorded version replaced by its offset from `base`. */
export function offsetText(text, base) {
  return typeof text === "string"
    ? text.replace(VERSION, (_, open, n, close) => `${open}+${Number(n) - base}${close}`)
    : text;
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The role of one exchange, from its method and path (the host differs locally). */
export function role(entry) {
  const path = entry.path ?? "";
  if (path.endsWith(":fetch")) return "fetch";
  if (path.endsWith(":streamFetchInvalidations")) return "realtime";
  if (path.endsWith("/authTokens:generate")) return "installation-token";
  if (path.endsWith("/installations")) return "installation-create";
  if (/\/installations\/[^/]+$/.test(path))
    return entry.method === "DELETE" ? "installation-delete" : "installation";
  return "other";
}

/** A JSON layout with string values replaced by `string` (lengths dropped). */
const layout = (value) => {
  if (Array.isArray(value)) return value.map(layout);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, layout(v)]));
  if (typeof value === "string") return value.startsWith("string:") ? "string" : value;
  return value;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The percent condition of the corpus (`fireemu_half`, seeded): its outcome depends on the
 * installation id, which each pass's SDK draws at random (pass 1 context two fell to the default,
 * pass 2 context two inside the half).
 */
const percentSwap = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a !== b &&
  /^(v[0-9])-(default|half)$/.test(a) &&
  /^(v[0-9])-(default|half)$/.test(b) &&
  a.split("-")[0] === b.split("-")[0];

function entriesDiff(a, b, differences, kds, at) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
  for (const key of keys) {
    if (a?.[key] === b?.[key]) continue;
    if (key === "fireemu_message" && percentSwap(a?.[key], b?.[key]))
      kds.add(kd("KD-WEB-PERCENT-INSTALLATION"));
    else differences.push({ path: `${at}.${key}`, kind: "value" });
  }
}

function headerDiff(a = {}, b = {}, differences, kds, at, { local }) {
  for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const [x, y] = [a[name], b[name]];
    if (x === y) continue;
    if (name === "etag" || name === "if-none-match") {
      if ((x === "*" || fetchTag(x)) && (y === "*" || fetchTag(y)) && (x === "*") === (y === "*"))
        kds.add(local ? kd("KD-WEB-FETCH-TAG-NUMBER") : "layout");
      else differences.push({ path: `${at}.${name}`, kind: "header" });
    } else if (
      local &&
      name === "content-encoding" &&
      at.endsWith("response") &&
      x === "gzip" &&
      y === undefined
    ) {
      kds.add(kd("KD-WEB-TRANSPORT-ENCODING"));
    } else if (
      local &&
      name === "vary" &&
      at.endsWith("response") &&
      x === "Origin, X-Origin, Referer" &&
      (y === undefined || y === "origin")
    ) {
      kds.add(kd("KD-WEB-VARY"));
    } else differences.push({ path: `${at}.${name}`, kind: "header" });
  }
}

/** Compares one exchange; returns its differences and the known differences it shows. */
function compareExchange(a, b, baseA, baseB, { local }) {
  const differences = [];
  const kds = new Set();
  const r = role(a);
  if (r !== role(b) || a.method !== b.method)
    return { differences: [{ path: "role", kind: "role" }], kds };
  if (a.path !== b.path) differences.push({ path: "path", kind: "path" });
  if (a.query !== b.query) differences.push({ path: "query", kind: "query" });
  if (a.status !== b.status) differences.push({ path: "status", kind: "status" });
  if (r.startsWith("installation")) {
    // The SDK's own requests are compared; locally the answers are the harness's (ruling 10).
    if (!same(layout(a.requestLayout), layout(b.requestLayout)))
      differences.push({ path: "requestLayout", kind: "layout" });
    headerDiff(a.requestHeaders, b.requestHeaders, differences, kds, "installation.request", {
      local,
    });
    if (local) kds.add(kd("KD-WEB-INSTALLATIONS-HARNESS"));
    else {
      if (!same(layout(a.responseLayout), layout(b.responseLayout)))
        differences.push({ path: "responseLayout", kind: "layout" });
      headerDiff(a.responseHeaders, b.responseHeaders, differences, kds, "installation.response", {
        local,
      });
      kds.add("layout");
    }
    return { differences, kds };
  }
  headerDiff(a.requestHeaders, b.requestHeaders, differences, kds, `${r}.request`, { local });
  headerDiff(a.responseHeaders, b.responseHeaders, differences, kds, `${r}.response`, { local });
  if (offsetText(a.requestBody, baseA) !== offsetText(b.requestBody, baseB))
    differences.push({ path: "requestBody", kind: "body" });
  if (r === "fetch") {
    const [ta, tb] = [offsetText(a.responseBody, baseA), offsetText(b.responseBody, baseB)];
    if (ta !== tb) {
      const [pa, pb] = [parse(ta), parse(tb)];
      const [x, y] = [pa?.entries?.fireemu_message, pb?.entries?.fireemu_message];
      // The recordings differ only in the evaluated percent value. Keep the rest of the
      // recorded body, including its member order and line breaks, in the comparison.
      if (
        percentSwap(x, y) &&
        tb.replace(
          `"fireemu_message": ${JSON.stringify(y)}`,
          `"fireemu_message": ${JSON.stringify(x)}`,
        ) === ta
      ) {
        kds.add(kd("KD-WEB-PERCENT-INSTALLATION"));
      } else differences.push({ path: "responseBody", kind: "body" });
    }
  } else if (r === "realtime") {
    if (offsetText(a.text, baseA) !== offsetText(b.text, baseB))
      differences.push({ path: "text", kind: "frames" });
    if ((a.chunkLengths ?? []).length !== (b.chunkLengths ?? []).length)
      differences.push({ path: "chunkLengths", kind: "frames" });
  }
  return { differences, kds };
}

/** The SDK uses the last fetch's ETag, and a conditional answer preserves its equality. */
function checkFetchTags(entry, previous, differences) {
  const kind = role(entry);
  if (kind !== "fetch" && kind !== "realtime") return;
  const sent = entry.requestHeaders?.["if-none-match"];
  if ((previous === "*" || fetchTag(previous)) && sent !== previous)
    differences.push({ path: "request.if-none-match", kind: "relation" });
  if (kind === "fetch") {
    const tag = entry.responseHeaders?.etag;
    const state = parse(entry.responseBody)?.state;
    if (
      !fetchTag(tag) ||
      (state === "NO_CHANGE" && tag !== sent) ||
      (state === "UPDATE" && tag === sent)
    ) {
      differences.push({ path: "response.etag", kind: "relation" });
    }
  }
}

function verdictOf(differences, kds) {
  if (differences.length) return "MISMATCH";
  const named = [...kds].filter((k) => k !== "layout");
  if (named.length) return "KNOWN_DIFFERENCE";
  return kds.has("layout") ? "MATCH_LAYOUT" : "MATCH";
}

const row = (id, { differences, kds }) => {
  const named = [...kds].filter((k) => k !== "layout").sort();
  return {
    id,
    verdict: verdictOf(differences, kds),
    differences,
    ...(named.length ? { knownDifferences: named } : {}),
  };
};

/**
 * Compares fixture `b` (a local run, or another pass) with fixture `a` (production). `local`
 * marks `b` as fireemu's.
 */
export function compare(a, b, { local = false } = {}) {
  const baseA = Number(a.baseline.before);
  const baseB = Number(b.baseline.before);
  const rows = [];
  const steps = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < steps; i += 1) {
    const [x, y] = [a.steps[i], b.steps[i]];
    if (!x || !y) {
      rows.push({
        id: `step-${i}`,
        verdict: "UNKNOWN",
        differences: [{ path: "step", kind: "missing" }],
      });
      continue;
    }
    const differences = [];
    const kds = new Set();
    if (x.name !== y.name) differences.push({ path: "name", kind: "value" });
    if ("version" in x && Number(x.version) - baseA !== Number(y.version) - baseB)
      differences.push({ path: "version", kind: "value" });
    for (const f of ["updated", "opened", "reopened", "first", "again"])
      if (x[f] !== y[f]) differences.push({ path: f, kind: "value" });
    rows.push(row(`step-${x.name}`, { differences, kds }));
  }
  for (const name of ["one", "two"]) {
    const [ca, cb] = [a.clients[name], b.clients[name]];
    const n = Math.max(ca.wire.length, cb.wire.length);
    let [tagA, tagB] = ["*", "*"];
    for (let i = 0; i < n; i += 1) {
      const [x, y] = [ca.wire[i], cb.wire[i]];
      if (!x || !y) {
        rows.push({
          id: `${name}-${i + 1}`,
          verdict: "UNKNOWN",
          differences: [{ path: "exchange", kind: "missing" }],
        });
        continue;
      }
      const compared = compareExchange(x, y, baseA, baseB, { local });
      checkFetchTags(x, tagA, compared.differences);
      checkFetchTags(y, tagB, compared.differences);
      if (role(x) === "fetch") tagA = x.responseHeaders?.etag;
      if (role(y) === "fetch") tagB = y.responseHeaders?.etag;
      rows.push(row(`${name}-${i + 1}-${role(x)}`, compared));
    }
    for (let i = 0; i < Math.max(ca.fetches.length, cb.fetches.length); i += 1) {
      const [x, y] = [ca.fetches[i], cb.fetches[i]];
      const differences = [];
      const kds = new Set();
      if (!x || !y) differences.push({ path: "fetch", kind: "missing" });
      else {
        for (const f of ["activated", "error", "lastFetchStatus"])
          if (x[f] !== y[f]) differences.push({ path: f, kind: "value" });
        const values = (f) =>
          Object.fromEntries(Object.entries(f.values ?? {}).map(([k, v]) => [k, v.value]));
        const sources = (f) =>
          Object.fromEntries(Object.entries(f.values ?? {}).map(([k, v]) => [k, v.source]));
        entriesDiff(values(x), values(y), differences, kds, "values");
        if (!same(sources(x), sources(y))) differences.push({ path: "sources", kind: "value" });
      }
      rows.push(row(`${name}-sdk-fetch-${i + 1}`, { differences, kds }));
    }
    const [ua, ub] = [ca.updates, cb.updates];
    rows.push(
      row(`${name}-updates`, {
        differences: same(ua, ub) ? [] : [{ path: "updates", kind: "value" }],
        kds: new Set(),
      }),
    );
  }
  const counts = { MATCH: 0, MATCH_LAYOUT: 0, KNOWN_DIFFERENCE: 0, MISMATCH: 0, UNKNOWN: 0 };
  for (const r of rows) counts[r.verdict] += 1;
  return { rows: rows.length, counts, table: rows };
}
