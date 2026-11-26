import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { nativeCapture } from "./capture.mjs";

const fid = "cRc0000000000000000000";
const key = "A00000000000000000000000000000000000000";
const projectNumber = "100000000004";
const projectId = "demo-native-config";
const appId = `1:${projectNumber}:ios:abcdef`;
const token = "opaque-installation-auth-value";
const refresh = "opaque-installation-refresh-value";
const settings = { platform: "ios", fid, key, projectNumber, projectId, appId };
const compressed = (text) => gzipSync(Buffer.from(text));

test("the evidence retains FIS relationships, SDK byte lengths and conditional ETags without credentials", () => {
  const capture = nativeCapture(settings);
  const installResponse = capture.response({
    operation: "create",
    fid,
    status: 200,
    headers: {},
    wire: Buffer.from(JSON.stringify({ fid, refreshToken: refresh, authToken: { token } })),
  });
  assert.equal(installResponse.body.fid, "FID_1");
  assert.equal(installResponse.body.refreshToken, "TOKEN_1");
  assert.equal(installResponse.body.authToken.token, "TOKEN_2");

  const etag = `etag-${projectNumber}-firebase-fetch-427`;
  const first = capture.response({
    operation: "fetch",
    fid,
    status: 200,
    headers: { etag },
    wire: Buffer.from(
      JSON.stringify({
        entries: { native_value: "before" },
        state: "UPDATE",
        templateVersion: "1",
      }),
    ),
  });
  const wire = compressed(
    `{app_instance_id:'${fid}', app_instance_id_token:'${token}', app_id:'${appId}', custom_signals:{"tier":"gold"}}`,
  );
  const request = capture.request({
    operation: "fetch",
    service: "fetch",
    fid,
    wire,
    path: `/v1/projects/${projectId}/namespaces/firebase:fetch?key=${key}`,
    headers: { "if-none-match": etag, "content-encoding": "gzip" },
  });
  assert.equal(request.ifNoneMatch, first.etag);
  assert.equal(request.requestBytes, wire.length);
  assert.equal(request.body.app_instance_id_token, installResponse.body.authToken.token);
  assert.deepEqual(request.body.custom_signals, { tier: "gold" });
  assert.equal(request.body.app_id, "APP_ID");
  assert.match(request.path, /PROJECT_ID/);
  const file = JSON.stringify({ installResponse, first, request });
  for (const raw of [projectId, projectNumber, key, fid, appId, token, refresh, etag]) {
    assert.ok(!file.includes(raw));
  }
});

test("provider refusals and malformed success bodies cannot turn into unmasked evidence", () => {
  const capture = nativeCapture(settings);
  assert.deepEqual(
    capture.response({ status: 403, operation: "fetch", headers: {}, wire: Buffer.from(key) }),
    { status: 403, responseBytes: key.length, encoding: "identity", etag: null, body: null },
  );
  assert.throws(
    () =>
      capture.response({
        status: 200,
        operation: "fetch",
        headers: { "content-encoding": "gzip" },
        wire: Buffer.from(key),
      }),
    /gzip/,
  );
  assert.throws(
    () =>
      capture.response({
        status: 200,
        operation: "fetch",
        headers: {},
        wire: Buffer.from('{"entries":{"x":"ya29.very_long_unknown_bearer"}}'),
      }),
    /secret/,
  );
});

test("the receiver masks partial stream contents as one bounded record with frame lengths", () => {
  const capture = nativeCapture(settings);
  const raw = `[{"latestTemplateVersionNumber":2,"project":"${projectNumber}"},\n{"latestTemplateVersionNumber":3},\n`;
  const wire = compressed(raw);
  const body = capture.stream({
    wire,
    headers: { "content-encoding": "gzip" },
    chunkLengths: [5, wire.length - 5],
  });
  assert.equal(body.responseBytes, wire.length);
  assert.deepEqual(body.chunkLengths, [5, wire.length - 5]);
  assert.equal(body.bodyText, raw.replace(projectNumber, "PROJECT_NUMBER"));
  assert.throws(() => capture.stream({ wire, headers: {}, chunkLengths: [1] }), /framing/);
});
