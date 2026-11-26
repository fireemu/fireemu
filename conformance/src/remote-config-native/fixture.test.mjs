import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { nativeFixture } from "./fixture.mjs";

const owner = {
  projectId: "demo-native-config",
  projectNumber: "100000000004",
  key: "synthetic-key",
  appId: "synthetic-app",
};
const fid = "cRc0000000000000000000";
const foreign = "cRc0000000000000000001";

const request = (target, body, options = {}) => ({
  method: "POST",
  target,
  apiKey: owner.key,
  wire: Buffer.from(JSON.stringify(body)),
  ...options,
});
const collection = `/installations/v1/projects/${owner.projectId}/installations`;
const fetchPath = `/fetch/v1/projects/${owner.projectNumber}/namespaces/firebase:fetch`;
const realtimePath = `/realtime/v1/projects/${owner.projectNumber}/namespaces/firebase:streamFetchInvalidations`;
const register = (fixture, suffix = "") =>
  fixture.receive(request(collection + suffix, { fid, appId: owner.appId }));

test("the fake owns one installation's registration, conditional fetch and delete", () => {
  const fixture = nativeFixture({ ...owner, platform: "android" });
  const fetch = request(fetchPath, { appInstanceId: fid, appId: owner.appId });
  assert.equal(fixture.receive(fetch).status, 400);
  assert.equal(fixture.receive(request(collection, { fid, appId: "unrelated" })).status, 400);
  const created = register(fixture);
  assert.equal(created.status, 200);
  assert.equal(created.body.fid, fid);
  assert.equal(created.body.authToken.expiresIn, "604800s");

  const update = fixture.receive(fetch);
  assert.equal(update.status, 200);
  assert.equal(update.body.state, "UPDATE");
  assert.equal(update.body.entries.native_value, "before");
  assert.equal(update.body.templateVersion, "1");
  assert.equal(fixture.receive({ ...fetch, etag: update.etag }).body.state, "NO_CHANGE");
  assert.equal(
    fixture.receive(request(`${collection}/${foreign}`, null, { method: "DELETE" })).status,
    400,
  );
  const remove = request(`${collection}/${fid}`, null, {
    method: "DELETE",
    wire: Buffer.alloc(0),
    encoding: "gzip",
  });
  assert.equal(fixture.receive(remove).status, 200);
  assert.equal(fixture.receive(remove).status, 400);
  assert.equal(fixture.receive(fetch).status, 400);
  assert.equal(fixture.summary().installations, 0);
  const summary = JSON.stringify(fixture.summary());
  for (const secret of [fid, owner.key, created.body.refreshToken, created.body.authToken.token]) {
    assert.ok(!summary.includes(secret));
  }
});

test("the iOS fake receives compressed non-JSON fetch and stream bodies unchanged", () => {
  const fixture = nativeFixture({ ...owner, platform: "ios" });
  assert.equal(register(fixture, "/").status, 200);
  const query = `?key=${owner.key}`;
  const fetch = request(fetchPath.replace(owner.projectNumber, owner.projectId) + query, null, {
    apiKey: "",
    encoding: "gzip",
    wire: gzipSync(
      Buffer.from(
        `{app_instance_id:'${fid}', app_id:'${owner.appId}', custom_signals:{"tier":"gold"}}`,
      ),
    ),
  });
  assert.equal(fixture.receive(fetch).body.entries.native_value, "before");
  const stream = request(realtimePath + query, null, {
    encoding: "gzip",
    wire: gzipSync(
      Buffer.from(`{appInstanceId:'${fid}', appId:'${owner.appId}', lastKnownVersionNumber:'1'}`),
    ),
  });
  assert.equal(fixture.receive(stream).stream, true);
  const frame = fixture.publish();
  assert.deepEqual(frame, { latestTemplateVersionNumber: 2 });
  const updated = fixture.receive(fetch);
  assert.equal(updated.body.entries.native_value, "after");
  assert.equal(updated.body.templateVersion, "2");
  const deletePath = `${collection}/${fid}/`;
  assert.equal(
    fixture.receive(request(deletePath, { raw: "unexpected" }, { method: "DELETE" })).status,
    400,
  );
  assert.equal(fixture.receive(request(deletePath, {}, { method: "DELETE" })).status, 200);
  assert.equal(fixture.summary().installations, 0);
  assert.deepEqual(
    fixture.summary().operations.map((event) => event.operation),
    ["create", "fetch", "realtime", "fetch", "delete"],
  );
  assert.equal(fixture.summary().operations[1].encoding, "gzip");
  assert.equal(fixture.summary().operations[1].requestBytes, fetch.wire.length);
});

test("invalid compression and malformed bodies add neither an operation nor ownership", () => {
  const fixture = nativeFixture({ ...owner, platform: "ios" });
  const bad = request(collection + "/", { fid, appId: owner.appId }, { encoding: "gzip" });
  assert.equal(fixture.receive(bad).status, 400);
  assert.equal(
    fixture.receive({ ...bad, encoding: undefined, wire: Buffer.from("{invalid") }).status,
    400,
  );
  assert.deepEqual(fixture.summary(), { installations: 0, operations: [] });
});
