import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { nativeRequest, nativeRequestBody } from "./wire.mjs";

const owner = {
  projectId: "demo-native-config",
  projectNumber: "100000000004",
  key: "synthetic-key",
  installations: new Set(["cRc0000000000000000000"]),
};

const fetchSuffix = "/namespaces/firebase:fetch";
const streamSuffix = "/namespaces/firebase:streamFetchInvalidations";
const root = "/v1/projects/";
const fid = [...owner.installations][0];
const parse = (platform, method, target, apiKey = owner.key) =>
  nativeRequest({ platform, method, target, apiKey }, owner);

test("each SDK uses its own exact Remote Config project forms", () => {
  const paths = [
    ["android", "fetch", owner.projectNumber, fetchSuffix],
    ["ios", "fetch", owner.projectId, fetchSuffix],
    ["android", "realtime", owner.projectNumber, streamSuffix],
    ["ios", "realtime", owner.projectNumber, streamSuffix],
  ];
  for (const [platform, service, project, suffix] of paths) {
    const query = platform === "ios" ? `?key=${owner.key}` : "";
    const apiKey = platform === "ios" && service === "fetch" ? "" : owner.key;
    const path = `${root}${project}${suffix}${query}`;
    assert.deepEqual(parse(platform, "POST", `/${service}${path}`, apiKey), {
      service,
      operation: service,
      path,
    });
    const other = project === owner.projectId ? owner.projectNumber : owner.projectId;
    assert.equal(
      parse(platform, "POST", `/${service}${path.replace(project, other)}`, apiKey),
      null,
    );
  }
});

test("Remote Config accepts only its exact SDK operation and query", () => {
  const fetchPath = `/fetch${root}${owner.projectId}${fetchSuffix}`;
  assert.equal(parse("ios", "GET", `${fetchPath}?key=${owner.key}`, ""), null);
  assert.equal(parse("ios", "POST", `${fetchPath}?key=someone-else`, ""), null);
  assert.equal(parse("ios", "POST", `${fetchPath}?key=${owner.key}&key=${owner.key}`, ""), null);
  assert.equal(parse("ios", "POST", `${fetchPath}?key=${owner.key}#fragment`, ""), null);
  assert.equal(parse("ios", "POST", `${fetchPath}?key=${owner.key}&extra=1`, ""), null);
  assert.equal(parse("ios", "POST", `${fetchPath}?key=${owner.key}`, owner.key), null);
  const androidPath = fetchPath.replace(owner.projectId, owner.projectNumber);
  assert.equal(parse("android", "POST", androidPath, "wrong-key"), null);
  assert.equal(parse("android", "POST", `${androidPath}?key=${owner.key}`), null);
  assert.equal(
    parse(
      "android",
      "POST",
      androidPath.replace("/namespaces/firebase", "/namespaces/firebase-server"),
    ),
    null,
  );
  assert.equal(parse("android", "POST", androidPath.replace("/fetch/", "/realtime/")), null);
});

test("absolute, ambiguous and nonnative request targets do not route", () => {
  const path = `${root}${owner.projectNumber}${fetchSuffix}`;
  for (const target of [
    `http://127.0.0.1/fetch${path}`,
    `//fetch${path}`,
    `/fetch/../fetch${path}`,
    `/fetch/%2e%2e/fetch${path}`,
    `/f%65tch${path}`,
    `/fetch${path.replace("/projects/", "/projects%2f")}`,
  ]) {
    assert.equal(parse("android", "POST", target), null, target);
  }
  assert.equal(parse("web", "POST", `/fetch${path}`), null);
});

test("Installations actions stay in the app's project and named requests need an owned installation", () => {
  const create = `${root}${owner.projectId}/installations`;
  const token = `${create}/${fid}/authTokens:generate`;
  const remove = `${create}/${fid}`;
  for (const platform of ["android", "ios"]) {
    for (const [method, path, operation] of [
      ["POST", create, "create"],
      ["POST", token, "token"],
      ["DELETE", remove, "delete"],
    ]) {
      assert.deepEqual(parse(platform, method, `/installations${path}`), {
        service: "installations",
        operation,
        path,
      });
      assert.equal(parse(platform, method, `/installations${path}?key=${owner.key}`), null);
    }
  }
  assert.equal(
    parse("ios", "POST", `/installations${token.replace(fid, "cRc0000000000000000001")}`),
    null,
  );
  assert.equal(
    parse(
      "android",
      "DELETE",
      `/installations${remove.replace(owner.projectId, owner.projectNumber)}`,
    ),
    null,
  );
});

test("the recorder sees decoded bytes while forwarding the identical compressed bytes", () => {
  const wire = gzipSync(Buffer.from("{appId:'synthetic',count:1}"));
  const body = nativeRequestBody(wire, "gzip");
  assert.strictEqual(body.wire, wire);
  assert.equal(body.decoded.toString(), "{appId:'synthetic',count:1}");
  const plain = Buffer.from("{}");
  assert.strictEqual(nativeRequestBody(plain, undefined).decoded, plain);
});

test("unknown encodings and over-limit input or inflated content are refused", () => {
  assert.throws(() => nativeRequestBody(Buffer.from("{}"), "x-gzip"), /encoding/);
  assert.throws(() => nativeRequestBody(Buffer.from("{}"), "gzip"), /gzip/);
  assert.throws(() => nativeRequestBody(Buffer.alloc(65_537), undefined), /limit/);
  assert.throws(() => nativeRequestBody(gzipSync(Buffer.alloc(65_537)), "gzip"), /limit/);
});

test("the generated native SDK route matrix accepts only the specified combinations", () => {
  const matrix = readFileSync(new URL("./wire-pict.tsv", import.meta.url), "utf8").trim();
  const [header, ...rows] = matrix.split("\n");
  assert.equal(header, "Platform\tOperation\tMethod\tProject\tKey\tTarget\tOwnership");
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const [platform, operation, method, project, key, target, ownership] = row.split("\t");
    const ios = platform === "ios";
    const installation = operation !== "fetch" && operation !== "realtime";
    const service = installation ? "installations" : operation;
    const projectPath = { id: owner.projectId, number: owner.projectNumber, other: "different" };
    const named = ownership === "owned" ? fid : "cRc0000000000000000001";
    const suffixes = {
      fetch: fetchSuffix,
      realtime: streamSuffix,
      create: "/installations",
      token: `/installations/${named}/authTokens:generate`,
      delete: `/installations/${named}`,
    };
    const mandatoryHeader = !ios || operation !== "fetch";
    const apiKeys = {
      expected: mandatoryHeader ? owner.key : "",
      missing: "",
      wrong: "incorrect",
      duplicated: `${owner.key}, ${owner.key}`,
    };
    const keyParams = {
      expected: `?key=${owner.key}`,
      missing: "",
      wrong: "?key=incorrect",
      duplicated: `?key=${owner.key}&key=${owner.key}`,
    };
    const basePath = `/${service}${root}${projectPath[project]}${suffixes[operation]}`;
    const request = ios && !installation ? basePath + keyParams[key] : basePath;
    const result = parse(
      platform,
      method,
      target === "alias" ? `/alias/..${request}` : request,
      apiKeys[key],
    );
    const expectedProject = installation || (ios && operation === "fetch") ? "id" : "number";
    const expectedMethod = operation === "delete" ? "DELETE" : "POST";
    const valid =
      project === expectedProject &&
      method === expectedMethod &&
      key === "expected" &&
      target === "literal" &&
      ownership === "owned";
    assert.equal(result?.operation ?? null, valid ? operation : null, row);
  }
});
