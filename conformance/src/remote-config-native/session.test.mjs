import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { nativeBudget, nativeSession } from "./session.mjs";

const projectId = "demo-native-config";
const projectNumber = "100000000004";
const key = "synthetic-key";
const fid = "cRc0000000000000000000";
const androidAppId = "1:100000000004:android:synthetic";
const iosAppId = "1:100000000004:ios:synthetic";
const apps = (budget = nativeBudget(12, 2)) => ({
  android: nativeSession({
    platform: "android",
    projectId,
    projectNumber,
    key,
    appId: androidAppId,
    budget,
  }),
  ios: nativeSession({ platform: "ios", projectId, projectNumber, key, appId: iosAppId, budget }),
  budget,
});
const collection = `/installations/v1/projects/${projectId}/installations`;
const fetchPath = `/fetch/v1/projects/${projectNumber}/namespaces/firebase:fetch`;
const streamPath = `/realtime/v1/projects/${projectNumber}/namespaces/firebase:streamFetchInvalidations`;
const request = (target, body, overrides = {}) => ({
  method: "POST",
  target,
  apiKey: key,
  installationAuth: "synthetic-token",
  authorization: "FIS_v2 synthetic-refresh",
  wire: Buffer.from(JSON.stringify(body)),
  ...overrides,
});
const create = (session, appId = androidAppId, suffix = "") =>
  session.reserve(request(collection + suffix, { fid, appId, authVersion: "FIS_v2" }));
const fetch = (session, appId = androidAppId) =>
  session.reserve(
    request(fetchPath, { appInstanceId: fid, appId, appInstanceIdToken: "synthetic-token" }),
  );
const remove = (session) =>
  session.reserve(
    request(collection + "/" + fid, null, {
      method: "DELETE",
      wire: Buffer.alloc(0),
      encoding: "gzip",
    }),
  );
const okay = (session, ticket) => session.settle(ticket, { status: 200 });
const registeredResponse = {
  status: 200,
  json: { fid, refreshToken: "synthetic-refresh", authToken: { token: "synthetic-token" } },
};

test("confirmation binds the FID to one app and only the owner can use its reservation", () => {
  const { android, ios, budget } = apps();
  const ticket = create(android);
  assert.equal(ticket.operation, "create");
  assert.equal(budget.used(), 1);
  assert.equal(fetch(android), null);
  assert.throws(() => ios.settle(ticket, registeredResponse), /reservation/);
  android.settle(ticket, registeredResponse);
  assert.throws(() => android.settle(ticket, registeredResponse), /reservation/);
  assert.equal(fetch(android, iosAppId), null);
  const otherPath = fetchPath.replace(projectNumber, projectId) + "?key=" + key;
  const compressed = gzipSync(
    Buffer.from(
      `{app_instance_id:'${fid}', app_id:'${iosAppId}', app_instance_id_token:'synthetic-token'}`,
    ),
  );
  assert.equal(
    ios.reserve(request(otherPath, null, { apiKey: "", wire: compressed, encoding: "gzip" })),
    null,
  );
  okay(android, fetch(android));
  assert.ok(!android.canClose());
  const deletion = remove(android);
  assert.equal(deletion.operation, "delete");
  okay(android, deletion);
  assert.ok(android.canClose());
});

test("a shared reservation cap closes the race and preserves cleanup capacity after a stop", () => {
  const { android, ios, budget } = apps(nativeBudget(4, 1));
  android.settle(create(android), registeredResponse);
  ios.settle(create(ios, iosAppId, "/"), registeredResponse);
  const requestBeforeStop = fetch(android);
  assert.ok(requestBeforeStop);
  assert.equal(fetch(android), null);
  assert.equal(budget.used(), 3);
  android.settle(requestBeforeStop, { status: 429 });
  assert.equal(budget.stopped(), true);
  assert.equal(fetch(android), null);
  const cleanup = remove(android);
  assert.ok(cleanup);
  assert.equal(budget.used(), 4);
  const iosDelete = request(`${collection}/${fid}/`, {}, { method: "DELETE" });
  assert.equal(ios.reserve(iosDelete), null);
  okay(android, cleanup);
  assert.ok(android.canClose());
  assert.ok(!ios.canClose());
});

test("an unknown create or delete remains open even if attempts settle", () => {
  const { android } = apps();
  android.settle(create(android), {
    ...registeredResponse,
    json: { ...registeredResponse.json, fid: "different" },
  });
  assert.equal(remove(android), null);
  assert.ok(!android.canClose());

  const second = apps().android;
  second.settle(create(second), registeredResponse);
  second.settle(remove(second), { status: 404 });
  assert.ok(!second.canClose());
  assert.equal(remove(second), null);
});

test("the iOS request's original gzip bytes remain the bytes of the reservation", () => {
  const { ios } = apps();
  ios.settle(create(ios, iosAppId, "/"), registeredResponse);
  const wire = gzipSync(
    Buffer.from(
      `{appInstanceId:'${fid}', appId:'${iosAppId}', lastKnownVersionNumber:'1', project:'${projectNumber}', namespace:'firebase'}`,
    ),
  );
  const ticket = ios.reserve(request(streamPath + "?key=" + key, null, { wire, encoding: "gzip" }));
  assert.strictEqual(ticket.wire, wire);
  assert.equal(ticket.operation, "realtime");
  assert.ok(!ios.canClose());
  okay(ios, ticket);
});

test("the reserved SDK request is bound to installation credentials and its realtime body scope", () => {
  const { android } = apps();
  android.settle(create(android), registeredResponse);
  const req = request(fetchPath, {
    appInstanceId: fid,
    appId: androidAppId,
    appInstanceIdToken: "synthetic-token",
  });
  assert.equal(android.reserve({ ...req, installationAuth: "other-installation" }), null);
  assert.equal(
    android.reserve({
      ...req,
      wire: Buffer.from(
        JSON.stringify({
          appInstanceId: fid,
          appId: androidAppId,
          appInstanceIdToken: "other-installation",
        }),
      ),
    }),
    null,
  );
  const realtime = {
    appInstanceId: fid,
    appId: androidAppId,
    project: projectNumber,
    namespace: "firebase",
    lastKnownVersionNumber: "1",
  };
  assert.equal(android.reserve(request(streamPath, { ...realtime, project: projectId })), null);
  assert.equal(
    android.reserve(request(streamPath, { ...realtime, namespace: "firebase-server" })),
    null,
  );
  assert.equal(
    android.reserve(request(streamPath, { ...realtime, lastKnownVersionNumber: "-1" })),
    null,
  );
  assert.ok(android.reserve(request(streamPath, realtime)));
  const deletion = request(`${collection}/${fid}`, null, {
    method: "DELETE",
    wire: Buffer.alloc(0),
  });
  assert.equal(android.reserve({ ...deletion, authorization: "FIS_v2 someone-else" }), null);
});
