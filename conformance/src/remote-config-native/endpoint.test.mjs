import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeDestination } from "./endpoint.mjs";

const wire = Buffer.from("fixture");
const androidFetch = {
  method: "POST",
  service: "fetch",
  operation: "fetch",
  path: "/v1/projects/100000000004/namespaces/firebase:fetch",
  headers: { "if-none-match": "known" },
  wire,
};
const iosRealtime = {
  ...androidFetch,
  service: "realtime",
  operation: "realtime",
  path: "/v1/projects/100000000004/namespaces/firebase:streamFetchInvalidations?key=fixture",
};

test("oracle planning pins the distinct service hosts without rewriting the SDK target", () => {
  const plan = nativeDestination({ kind: "oracle" });
  const a = plan(androidFetch);
  const b = plan(iosRealtime);
  assert.equal(a.protocol, "https:");
  assert.equal(a.hostname, "firebaseremoteconfig.googleapis.com");
  assert.equal(b.hostname, "firebaseremoteconfigrealtime.googleapis.com");
  assert.equal(b.path, iosRealtime.path);
  assert.strictEqual(b.wire, wire);
  assert.deepEqual(b.headers, iosRealtime.headers);
  assert.equal(plan({ ...androidFetch, operation: "fetch", service: "other" }), null);
  assert.equal(plan({ ...androidFetch, path: "//wrong.invalid/v1/projects/x" }), null);
  assert.equal(plan({ ...androidFetch, path: "/v1/projects/no/../x" }), null);
});

test("local dispatch uses two literal loopback ports and does not substitute the project identity", () => {
  const plan = nativeDestination({
    kind: "local",
    remoteConfig: "http://127.0.0.1:18110",
    installations: "http://127.0.0.1:18111",
  });
  const a = plan(iosRealtime);
  const b = plan({
    ...androidFetch,
    service: "installations",
    operation: "create",
    path: "/v1/projects/demo-config/installations",
  });
  assert.equal(a.protocol, "http:");
  assert.equal(a.hostname, "127.0.0.1");
  assert.equal(a.port, 18110);
  assert.equal(a.path, iosRealtime.path);
  assert.equal(b.port, 18111);
  for (const origin of [
    "https://127.0.0.1:18110",
    "http://another.invalid:18110",
    "http://127.0.0.1:18110/path",
    "http://invalid@127.0.0.1:18110",
    "http://127.0.0.1",
  ]) {
    assert.throws(
      () =>
        nativeDestination({
          kind: "local",
          remoteConfig: origin,
          installations: "http://127.0.0.1:18111",
        }),
      /loopback/,
    );
  }
});
