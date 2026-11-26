import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  compareNative,
  FILES,
  projection,
  readNativeRun,
  verifyNativeArtifacts,
} from "./evidence.mjs";

const call = (sequence, operation, extra) => ({ sequence, operation, phase: "request", ...extra });
const done = (sequence, operation, extra) => ({
  sequence,
  operation,
  phase: "response",
  status: 200,
  ...extra,
});
const versions = { initial: "41", update: "42" };
const android = [
  call(1, "create", { path: "/v1/projects/PROJECT_ID/installations", body: { fid: "FID_1" } }),
  done(1, "create", { body: { authToken: { token: "TOKEN_1" } } }),
  call(2, "fetch", {
    path: "/v1/projects/PROJECT_NUMBER/namespaces/firebase:fetch",
    headers: { "x-firebase-rc-fetch-type": "BASE/1" },
    body: { customSignals: { tier: "gold" } },
  }),
  done(2, "fetch", {
    etag: "ETAG_1",
    encoding: "gzip",
    body: {
      state: "UPDATE",
      entries: { native_value: "before", native_tier: "gold" },
      templateVersion: "41",
    },
  }),
  call(3, "realtime", {
    path: "/v1/projects/PROJECT_NUMBER/namespaces/firebase:streamFetchInvalidations",
    body: { lastKnownVersionNumber: "41" },
  }),
  call(4, "fetch", {
    path: "/v1/projects/PROJECT_NUMBER/namespaces/firebase:fetch",
    ifNoneMatch: "ETAG_1",
    headers: { "x-firebase-rc-fetch-type": "REALTIME/1" },
  }),
  done(4, "fetch", {
    etag: "ETAG_2",
    encoding: "gzip",
    body: {
      state: "UPDATE",
      entries: { native_value: "after", native_tier: "gold" },
      templateVersion: "42",
    },
  }),
  {
    sequence: 3,
    operation: "realtime",
    phase: "stream",
    status: 200,
    termination: "client-disconnect",
    encoding: "gzip",
    bodyText: '[{"latestTemplateVersionNumber":"42"}',
  },
  call(5, "delete", { path: "/v1/projects/PROJECT_ID/installations/FID_1" }),
  done(5, "delete", { status: 204 }),
];

const receipt = {
  steps: [
    { op: "settings" },
    { op: "defaults" },
    { op: "signals" },
    { op: "fetch", lastFetchStatus: -1, fetchTimeMillis: 7, values: values("", 0) },
    { op: "activate", changed: true, values: values("before") },
    { op: "fetch", lastFetchStatus: -1, fetchTimeMillis: 7, values: values("before") },
    { op: "observe", event: { updatedKeys: ["native_value"] }, values: values("before") },
    { op: "activate", changed: true, values: values("after") },
    { op: "delete-installation", deleted: true },
  ],
};
function values(value, source = 2) {
  return {
    native_value: { string: value, source },
    native_tier: { string: source === 2 ? "gold" : "", source },
    unpublished_default: { string: "app default", source: 1 },
    missing_value: { string: "", source: 0 },
  };
}

test("native capture projects authorized version relations and evidence for automatic fetch", () => {
  const capture = projection("android", android, receipt, versions);
  assert.equal(capture.exchanges[1].response.body.templateVersion, "INITIAL_VERSION");
  assert.equal(capture.exchanges[2].request.body.lastKnownVersionNumber, "INITIAL_VERSION");
  assert.equal(capture.exchanges[2].response.body.latestTemplateVersionNumber, "UPDATED_VERSION");
  assert.equal(capture.exchanges[3].request.ifNoneMatch, "ETAG_1");
  assert.equal(capture.exchanges[3].request.headers["x-firebase-rc-fetch-type"], "REALTIME/1");
  const wrongVersion = structuredClone(android);
  wrongVersion[6].body.templateVersion = "41";
  assert.throws(() => projection("android", wrongVersion, receipt, versions), /version/);
});

test("native comparisons report wire changes and narrowly classify local gzip transport", () => {
  const expected = projection("android", android, receipt, versions);
  const local = structuredClone(expected);
  local.exchanges[1].response.encoding = "identity";
  assert.deepEqual(compareNative(expected, local, true).differences, []);
  assert.deepEqual(compareNative(expected, local, true).known, ["KD-NATIVE-RESPONSE-ENCODING"]);
  assert.equal(compareNative(expected, local, false).differences.length, 1);
  local.exchanges[3].request.headers["x-firebase-rc-fetch-type"] = "BASE/1";
  const unequal = compareNative(expected, local, true);
  assert.ok(
    unequal.differences.some(
      ({ role, field }) => role === "automatic-fetch" && field === "headers",
    ),
  );
});

test("native fetch comparisons accept only the recorded response member order difference", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path) => JSON.parse(readFileSync(new URL(path, root)));
  const expected = read(FILES.pass1).android;
  const local = read(FILES.strict).android;
  const id = "KD-NATIVE-FETCH-MEMBER-ORDER";
  assert.ok(compareNative(expected, local, true).known.includes(id));
  assert.ok(
    compareNative(expected, local, false).differences.some(({ field }) => field === "layout"),
  );

  const initial = local.exchanges[1];
  initial.response.layout.finalNewline = false;
  assert.ok(
    compareNative(expected, local, true).differences.some(
      ({ role, field }) => role === "initial-fetch" && field === "layout",
    ),
  );
  initial.response.layout.finalNewline = true;
  const { state, ...rest } = initial.response.body;
  initial.response.body = { state, ...rest };
  const shuffled = compareNative(expected, local, true);
  assert.ok(
    shuffled.differences.some(({ role, field }) => role === "initial-fetch" && field === "layout"),
  );

  local.exchanges[3].request.layout.tokens = "{}";
  assert.ok(
    compareNative(expected, local, true).differences.some(
      ({ role, boundary, field }) =>
        role === "automatic-fetch" && boundary === "request" && field === "layout",
    ),
  );
});

test("native source intake refuses a mismatched production pass, profile, or role", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "native-evidence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
  write("result.json", { pass: "c1", runId: "demo", adminRequests: 10 });
  assert.throws(() => readNativeRun(dir, "pass2"), /native source slot/);
  write("result.json", { pass: "c1", runId: "demo", profile: "strict" });
  assert.throws(() => readNativeRun(dir, "pass1"), /native source slot/);
  assert.throws(() => readNativeRun(dir, "emulator"), /native source slot/);
});

test("both production captures and both local profiles bind the verified parent evidence", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path) => readFileSync(new URL(path, root));
  const list = (path) => readdirSync(new URL(path, root));
  assert.deepEqual(verifyNativeArtifacts({ read, list }), []);
  const changed = (path) =>
    path === FILES.pass2
      ? read(path).toString().replace('"appName": "NATIVE_BUNDLE"', '"appName": "wrong-app"')
      : read(path);
  assert.match(verifyNativeArtifacts({ read: changed, list }).join(), /record digest/);
  const forged = JSON.parse(read(FILES.emulator));
  forged.android.exchanges[4].response.status = 500;
  const bytes = JSON.stringify(forged);
  const lock = "spec/compatibility/closure/record-digests.json";
  const digests = JSON.parse(read(lock));
  digests.records[FILES.emulator] = createHash("sha256").update(bytes).digest("hex");
  const forgedRead = (path) =>
    path === FILES.emulator ? bytes : path === lock ? JSON.stringify(digests) : read(path);
  assert.match(verifyNativeArtifacts({ read: forgedRead, list }).join(), /native fixture contract/);

  const duplicate = JSON.parse(read(FILES.pass2));
  duplicate.source.runSha256 = JSON.parse(read(FILES.pass1)).source.runSha256;
  const duplicateBytes = JSON.stringify(duplicate);
  digests.records[FILES.emulator] = JSON.parse(read(lock)).records[FILES.emulator];
  digests.records[FILES.pass2] = createHash("sha256").update(duplicateBytes).digest("hex");
  const duplicateRead = (path) =>
    path === FILES.pass2 ? duplicateBytes : path === lock ? JSON.stringify(digests) : read(path);
  assert.match(
    verifyNativeArtifacts({ read: duplicateRead, list }).join(),
    /distinct native source/,
  );
});
