import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { verifyNativeExchange, verifyNativeReceipt } from "./device-client.mjs";

const PLATFORMS = ["android", "ios"];
const ROLES = [
  "installation-create",
  "initial-fetch",
  "realtime",
  "automatic-fetch",
  "installation-delete",
];
const REQUEST_FIELDS = ["path", "encoding", "headers", "credentials", "ifNoneMatch", "body"];
const RESPONSE_FIELDS = ["status", "encoding", "headers", "etag", "body", "termination"];
const BUNDLE_NAME = /com\.fireemu\.oracle\.rc(?:android|ios)20261121\.c[12]/g;
const PRIVATE_VALUES =
  /AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|fireemu-oracle-query/;
const sha = (text) => createHash("sha256").update(text).digest("hex");

function clean(value) {
  if (typeof value === "string") return value.replace(BUNDLE_NAME, "NATIVE_BUNDLE");
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        key === "x-android-cert" && typeof field === "string" ? "APP_CERTIFICATE" : clean(field),
      ]),
    );
  return value;
}

function select(row, fields) {
  return Object.fromEntries(
    fields.filter((name) => name in row).map((name) => [name, clean(row[name])]),
  );
}

function recordedVary(left, right) {
  if (
    left?.vary !== "Origin, X-Origin, Referer" ||
    (right?.vary !== undefined && right.vary !== "origin")
  )
    return false;
  const { vary: _leftVary, ...leftHeaders } = left;
  const { vary: _rightVary, ...rightHeaders } = right ?? {};
  return isDeepStrictEqual(leftHeaders, rightHeaders);
}

function frame(bodyText) {
  const text = bodyText.trim();
  const [message] = JSON.parse(text.endsWith("]") ? text : text + "]");
  return message;
}

/** Write only the verified SDK facts and the sanitized, ordered wire exchange. */
export function projection(platform, rows, receipt, versions) {
  if (!verifyNativeExchange(rows, versions) || !verifyNativeReceipt(platform, receipt))
    throw new Error("incomplete native SDK or wire evidence");
  const requests = rows.filter(({ phase }) => phase === "request");
  const exchanges = requests.map((row, index) => {
    const role = ROLES[index];
    const answer = rows.find(
      (event) => event.sequence === row.sequence && event.phase !== "request",
    );
    const request = select(row, REQUEST_FIELDS);
    const response = select(answer, RESPONSE_FIELDS);
    if (row.layout) request.layout = row.layout;
    if (answer.layout) response.layout = answer.layout;
    if (role === "initial-fetch" || role === "automatic-fetch") {
      const first = role === "initial-fetch";
      if (response.body?.templateVersion !== (first ? versions.initial : versions.update))
        throw new Error("native fetch returned a different template version");
      response.body.templateVersion = first ? "INITIAL_VERSION" : "UPDATED_VERSION";
    }
    if (role === "realtime") {
      request.body.lastKnownVersionNumber = "INITIAL_VERSION";
      response.body = { ...frame(answer.bodyText), latestTemplateVersionNumber: "UPDATED_VERSION" };
    }
    return { role, request, response };
  });
  const result = {
    platform,
    sdk: {
      initial: "before",
      cached: "before",
      updateKeys: ["native_value"],
      activated: "after",
      installationDeleted: true,
    },
    exchanges,
  };
  if (PRIVATE_VALUES.test(JSON.stringify(result)))
    throw new Error("private value in native fixture");
  return result;
}

const SOURCE_SLOTS = {
  pass1: { pass: "c1", production: true },
  pass2: { pass: "c2", production: true },
  strict: { pass: "c1", profile: "strict", production: false },
  emulator: { pass: "c1", profile: "emulator", production: false },
};

export function readNativeRun(out, slot) {
  const digests = {};
  const read = (name) => {
    const bytes = readFileSync(join(out, name));
    digests[name] = sha(bytes);
    return bytes.toString("utf8");
  };
  const result = JSON.parse(read("result.json"));
  const production = Object.hasOwn(result, "adminRequests");
  const expected = Object.hasOwn(SOURCE_SLOTS, slot) ? SOURCE_SLOTS[slot] : undefined;
  if (
    !expected ||
    expected.production !== production ||
    result.pass !== expected.pass ||
    result.profile !== expected.profile ||
    typeof result.runId !== "string" ||
    result.runId.length === 0
  )
    throw new Error("native source slot does not match the run receipt");

  let terminal =
    result.complete === true && result.sandboxAtBaseline === true && result.open?.length === 0;
  if (production) {
    const closure = JSON.parse(read("closure.json"));
    const accepted =
      closure.runId === result.runId &&
      closure.resultSha256 === digests["result.json"] &&
      closure.accepted === true;
    if (accepted && closure.recovered === true) {
      const recovery = JSON.parse(read("recovery.json"));
      terminal =
        recovery.complete === true &&
        recovery.runId === result.runId &&
        recovery.activeKeysRestored === true &&
        recovery.keyTombstone === true &&
        recovery.appTombstones === 2 &&
        recovery.templateVersion === String(BigInt(result.versions.update) + 1n) &&
        isDeepStrictEqual(result.open, ["app or key cleanup unverified"]);
    }
    terminal &&= accepted && result.unknown?.length === 0;
  }
  if (
    !terminal ||
    result.leakScanClean !== true ||
    result.nativeRequests !== 10 ||
    !isDeepStrictEqual(result.verified, PLATFORMS)
  )
    throw new Error("native run is incomplete");
  const clients = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      projection(
        platform,
        read(platform + "-wire.jsonl")
          .trim()
          .split("\n")
          .map(JSON.parse),
        JSON.parse(read(platform + "-sdk.json")),
        result.versions,
      ),
    ]),
  );
  return {
    source: {
      slot,
      runSha256: sha(JSON.stringify([result.profile ?? "production", result.runId])),
      receiptSha256: sha(JSON.stringify(digests)),
    },
    ...clients,
  };
}

function orderedLayout(response, fetch) {
  if (!fetch) return response.layout;
  return {
    layout: response.layout,
    members: Object.keys(response.body ?? {}),
    entries: Object.keys(response.body?.entries ?? {}),
  };
}

function recordedFetchMemberOrder(left, right, a, b) {
  const jsonLayout = (tokens) => ({ format: "json", tokens, finalNewline: true });
  return (
    isDeepStrictEqual(a.body, b.body) &&
    isDeepStrictEqual(left.entries, right.entries) &&
    isDeepStrictEqual(left.members, ["entries", "appName", "state", "templateVersion"]) &&
    isDeepStrictEqual(right.members, ["appName", "entries", "state", "templateVersion"]) &&
    isDeepStrictEqual(left.layout, jsonLayout("{wd:w{wd:wd,wd:wdw},wd:wd,wd:wd,wd:wdw}w")) &&
    isDeepStrictEqual(right.layout, jsonLayout("{wd:wd,wd:w{wd:wd,wd:wdw},wd:wd,wd:wdw}w"))
  );
}

export function compareNative(observed, other, local) {
  const known = new Set();
  const differences = [];
  if (
    observed.platform !== other.platform ||
    observed.exchanges?.length !== ROLES.length ||
    other.exchanges?.length !== ROLES.length
  )
    throw new Error("native evidence platform or exchange count changed");
  if (!isDeepStrictEqual(observed.sdk, other.sdk))
    differences.push({
      role: "sdk",
      boundary: "callback",
      field: "result",
      left: observed.sdk,
      right: other.sdk,
    });

  for (const [index, role] of ROLES.entries()) {
    const a = observed.exchanges[index];
    const b = other.exchanges[index];
    if (a.role !== role || b.role !== role) throw new Error("native exchange order changed");
    const installation = role.startsWith("installation");
    const fetch = role === "initial-fetch" || role === "automatic-fetch";

    for (const field of [...REQUEST_FIELDS, "layout"]) {
      const left = a.request[field];
      const right = b.request[field];
      if (!isDeepStrictEqual(left, right))
        differences.push({ role, boundary: "request", field, left, right });
    }

    for (const field of [...RESPONSE_FIELDS, "layout"]) {
      const left = field === "layout" ? orderedLayout(a.response, fetch) : a.response[field];
      const right = field === "layout" ? orderedLayout(b.response, fetch) : b.response[field];
      if (isDeepStrictEqual(left, right)) continue;
      if (installation && local) known.add("KD-NATIVE-INSTALLATIONS-FIXTURE");
      else if (field === "encoding" && local && left === "gzip" && right === "identity")
        known.add("KD-NATIVE-RESPONSE-ENCODING");
      else if (
        field === "layout" &&
        fetch &&
        local &&
        recordedFetchMemberOrder(left, right, a.response, b.response)
      )
        known.add("KD-NATIVE-FETCH-MEMBER-ORDER");
      else if (field === "headers" && local && recordedVary(left, right))
        known.add("KD-NATIVE-VARY");
      else differences.push({ role, boundary: "response", field, left, right });
    }
  }
  return { known: [...known].toSorted(), differences };
}

export const DIR = "conformance/remote-config-native";
export const FILES = {
  pass1: DIR + "/closure-c-pass-1.json",
  pass2: DIR + "/closure-c-pass-2.json",
  strict: DIR + "/closure-c-local-strict.json",
  emulator: DIR + "/closure-c-local-emulator.json",
  comparison: DIR + "/closure-c-comparisons.json",
};
const LOCK = "spec/compatibility/closure/record-digests.json";
const RECORD = "spec/compatibility/closure/REMOTE-CONFIG.json";
const CONDITIONS = ["REMOTE-CONFIG/client-fetch-and-activate", "REMOTE-CONFIG/realtime-updates"];

export const KNOWN = {
  "KD-NATIVE-FETCH-MEMBER-ORDER":
    "The recorded native fetch responses place entries before appName in Google and appName before entries in Fireemu. Parsed values and activation are identical.",
  "KD-NATIVE-INSTALLATIONS-FIXTURE":
    "Fireemu uses the scoped Installations fixture for these SDK runs. The SDK's own create and delete requests are captured and compared.",
  "KD-NATIVE-RESPONSE-ENCODING":
    "The observed Google data-plane responses use gzip. Fireemu sends the same decoded response over loopback with identity encoding.",
  "KD-NATIVE-VARY":
    "Google lists Origin, X-Origin and Referer in the response Vary header. The loopback listener uses Fireemu's CORS header policy.",
};

export function buildComparisons(fixtures) {
  return {
    schemaVersion: 1,
    kind: "remote-config-native-sdk-v1",
    comparisons: Object.fromEntries(
      [
        ["pass1VsPass2", "pass1", "pass2", false],
        ["strictVsPass1", "pass1", "strict", true],
        ["strictVsPass2", "pass2", "strict", true],
        ["emulatorVsPass1", "pass1", "emulator", true],
        ["emulatorVsPass2", "pass2", "emulator", true],
      ].map(([label, from, to, local]) => [
        label,
        Object.fromEntries(
          PLATFORMS.map((platform) => [
            platform,
            compareNative(fixtures[from][platform], fixtures[to][platform], local),
          ]),
        ),
      ]),
    ),
    knownDifferences: KNOWN,
  };
}

export function nativeMetadata(records) {
  const sources = (entries) =>
    entries.map(([alias, key]) => ({
      alias,
      fixturePath: FILES[key],
      fixtureSha256: records[FILES[key]],
    }));
  return {
    recordingPolicy: { observedPasses: 2, requiredPasses: 2, waiver: null },
    recordings: sources([
      ["native-pass-1", "pass1"],
      ["native-pass-2", "pass2"],
    ]),
    localRuns: sources([
      ["strict", "strict"],
      ["emulator", "emulator"],
    ]),
    comparisonPath: FILES.comparison,
    comparisonSha256: records[FILES.comparison],
    knownDifferences: Object.keys(KNOWN),
  };
}

const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function validFixture(fixture, slot) {
  if (
    PRIVATE_VALUES.test(JSON.stringify(fixture)) ||
    !isDeepStrictEqual(Object.keys(fixture).toSorted(), [...PLATFORMS, "source"]) ||
    fixture.source?.slot !== slot ||
    !isDigest(fixture.source.runSha256) ||
    !isDigest(fixture.source.receiptSha256)
  )
    return false;
  return PLATFORMS.every((platform) => {
    const client = fixture[platform];
    const fetch =
      platform === "android"
        ? "/v1/projects/PROJECT_NUMBER/namespaces/firebase:fetch"
        : "/v1/projects/PROJECT_ID/namespaces/firebase:fetch?key=API_KEY";
    const stream =
      "/v1/projects/PROJECT_NUMBER/namespaces/firebase:streamFetchInvalidations" +
      (platform === "ios" ? "?key=API_KEY" : "");
    return (
      client?.platform === platform &&
      client.exchanges?.map(({ role }) => role).join(" ") === ROLES.join(" ") &&
      client.exchanges.slice(0, 4).every(({ response }) => response.status === 200) &&
      [200, 204].includes(client.exchanges[4].response.status) &&
      client.sdk?.initial === "before" &&
      client.sdk.cached === "before" &&
      client.sdk.activated === "after" &&
      client.sdk.installationDeleted === true &&
      isDeepStrictEqual(client.sdk.updateKeys, ["native_value"]) &&
      client.exchanges[1].response.body?.entries?.native_value === "before" &&
      client.exchanges[1].response.body?.appName === "NATIVE_BUNDLE" &&
      client.exchanges[3].response.body?.appName === "NATIVE_BUNDLE" &&
      client.exchanges[1].request.path === fetch &&
      client.exchanges[3].request.path === fetch &&
      client.exchanges[2].request.path === stream &&
      client.exchanges[2].response.termination === "client-disconnect" &&
      client.exchanges[2].response.body?.latestTemplateVersionNumber === "UPDATED_VERSION" &&
      client.exchanges[3].response.body?.entries?.native_value === "after" &&
      client.exchanges[3].request.headers?.["x-firebase-rc-fetch-type"] === "REALTIME/1" &&
      /^ETAG_\d+$/.test(client.exchanges[1].response.etag) &&
      /^ETAG_\d+$/.test(client.exchanges[3].response.etag) &&
      client.exchanges[1].response.etag !== client.exchanges[3].response.etag &&
      client.exchanges[3].request.ifNoneMatch === client.exchanges[1].response.etag
    );
  });
}

export function verifyNativeArtifacts({ list, read }) {
  try {
    if (
      !isDeepStrictEqual(
        list(DIR)
          .map((path) => DIR + "/" + path)
          .toSorted(),
        Object.values(FILES).toSorted(),
      )
    )
      return ["native evidence directory differs from its exact artifact list"];
    const records = JSON.parse(read(LOCK)).records;
    const docs = {};
    const runs = new Set();
    const receipts = new Set();
    for (const [key, path] of Object.entries(FILES)) {
      const bytes = read(path);
      if (records[path] !== sha(bytes)) return [path + " differs from its record digest"];
      docs[key] = JSON.parse(bytes);
      if (key === "comparison") continue;
      if (!validFixture(docs[key], key)) return [path + " fails the native fixture contract"];
      const { runSha256, receiptSha256 } = docs[key].source;
      if (runs.has(runSha256) || receipts.has(receiptSha256))
        return ["each fixture must have a distinct native source"];
      runs.add(runSha256);
      receipts.add(receiptSha256);
    }
    const actual = buildComparisons(docs);
    if (!isDeepStrictEqual(actual, docs.comparison))
      return ["native comparison differs from the pinned fixtures"];
    for (const [label, cells] of Object.entries(actual.comparisons)) {
      if (Object.values(cells).some((cell) => cell.differences.length > 0))
        return [label + " contains a native mismatch"];
    }
    const record = JSON.parse(read(RECORD));
    if (record.parentStatus !== "COMPAT_VERIFIED") return ["Remote Config parent is not closed"];
    const metadata = nativeMetadata(records);
    if (!isDeepStrictEqual(record.nativeEvidence, metadata))
      return ["Remote Config native evidence metadata differs from its pinned artifacts"];
    const declared = Object.fromEntries(
      (record.approvedKnownDifferences ?? []).map(({ id, reason }) => [id, reason]),
    );
    if (Object.entries(KNOWN).some(([id, reason]) => declared[id] !== reason))
      return ["Remote Config has undeclared native wire differences"];
    for (const id of CONDITIONS) {
      const condition = record.conditions.find((entry) => entry.conditionId === id);
      const proofs = condition?.productionEvidence.filter(({ fixturePath }) =>
        fixturePath.startsWith(DIR + "/"),
      );
      if (condition?.status !== "VERIFIED" || !isDeepStrictEqual(proofs, metadata.recordings))
        return [id + " lacks the pinned native recording pair"];
    }
    return [];
  } catch {
    return ["native evidence cannot be read or classified"];
  }
}
