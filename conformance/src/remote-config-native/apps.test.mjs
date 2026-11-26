import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeAppRegistry } from "./apps.mjs";

const project = "demo-native-config";
const number = "100000000004";
const bundle = "com.example.fixture.pass1";
const name = "fixture-stage-c-pass1-android";
const platform = "android";
const apiKeyId = "934c1011-e912-4c1e-8f5f-e2097dbc71f9";
const id = `1:${number}:android:aa0011`;
const existing = `1:${number}:android:bb0022`;
const origin = "https://firebase.googleapis.com";
const collection = `${origin}/v1beta1/projects/${project}/androidApps`;
const resource = `${collection}/${id}`;
const operation = `${origin}/v1beta1/operations/sample/create`;
const removeOperation = `${origin}/v1beta1/operations/sample/remove`;
const app = {
  appId: id,
  apiKeyId,
  packageName: bundle,
  displayName: name,
  etag: "owned-app-tag",
  state: "ACTIVE",
};
const baseline = [
  { appId: existing, packageName: "com.example.other", displayName: "unchanged", state: "ACTIVE" },
];
const response = (json, status = 200) => ({ status, json });

function registry(sends) {
  const calls = [];
  let next = 0;
  const service = nativeAppRegistry({
    project,
    number,
    platform,
    bundle,
    name,
    pause: () => {},
    polls: 2,
    async send(caseId, rawURL, options = {}) {
      const method = options.method ?? "GET";
      assert.ok(service.allow(new URL(rawURL), method), `${caseId} inadmissible`);
      calls.push([method, rawURL, options.body]);
      const expected = sends[next++];
      assert.ok(expected, `${caseId} unexpected extra call`);
      assert.equal(rawURL, expected[0]);
      if (expected[1] instanceof Error) throw expected[1];
      return expected[1];
    },
  });
  return { service, calls };
}

test("the lifecycle binds reads, polls and removal to the exact created app", async () => {
  const { service, calls } = registry([
    [collection, response({ apps: baseline })],
    [collection, response({ name: "operations/sample/create" })],
    [operation, response({ name: "operations/sample/create", done: true, response: app })],
    [resource, response(app)],
    [resource, response(app)],
    [resource + ":remove", response({ name: "operations/sample/remove" })],
    [
      removeOperation,
      response({
        name: "operations/sample/remove",
        done: true,
        response: { ...app, state: "DELETED" },
      }),
    ],
    [collection, response({ apps: baseline })],
  ]);
  const allow = (target, method = "GET") => service.allow(new URL(target), method);
  assert.equal(allow(resource), false);
  assert.equal(allow(operation), false);
  assert.throws(() => service.assertClosed(), /baseline/);
  await assert.rejects(service.create(apiKeyId), /baseline/);
  await service.inspect();
  const created = await service.create(apiKeyId);
  assert.equal(created.appId, id);
  assert.equal(allow(resource), true);
  assert.equal(allow(resource.replace(id, existing)), false);
  assert.equal(allow(resource.replace(project, "wrong-project")), false);
  assert.equal(allow(resource + "/config"), false);
  assert.equal(allow(resource + ":remove", "GET"), false);
  assert.deepEqual(calls[1][2], { packageName: bundle, displayName: name, apiKeyId });
  assert.throws(() => service.assertClosed(), /app remains/);
  await service.remove();
  assert.deepEqual(calls[5][2], { etag: app.etag });
  assert.equal(service.assertClosed(), true);
});

test("an unknown create cannot be closed merely because the app is absent", async () => {
  const { service } = registry([
    [collection, response({ apps: baseline })],
    [collection, new Error("transport ended before the create result")],
  ]);
  await service.inspect();
  await assert.rejects(service.create(apiKeyId), /transport/);
  assert.throws(() => service.assertClosed(), /app remains/);
  assert.equal(service.allow(new URL(resource + ":remove"), "POST"), false);
});

test("a terminal removal followed by a contradictory active list remains unsettled", async () => {
  const { service } = registry([
    [collection, response({ apps: baseline })],
    [collection, response({ name: "operations/sample/create", done: true, response: app })],
    [resource, response(app)],
    [resource, response(app)],
    [
      resource + ":remove",
      response({
        name: "operations/sample/remove",
        done: true,
        response: { ...app, state: "DELETED" },
      }),
    ],
    [collection, response({ apps: [...baseline, app] })],
  ]);
  await service.inspect();
  await service.create(apiKeyId);
  await assert.rejects(service.remove(), /restored/);
  assert.throws(() => service.assertClosed(), /app remains/);
});

test("a registration associated with another key cannot arm an SDK", async () => {
  const { service } = registry([
    [collection, response({ apps: baseline })],
    [collection, response({ name: "operations/sample/create", done: true, response: app })],
    [resource, response({ ...app, apiKeyId: "unowned" })],
  ]);
  await service.inspect();
  await assert.rejects(service.create(apiKeyId), /ownership/);
  assert.throws(() => service.assertClosed(), /app remains/);
});

test("pre-write inspection rejects occupied, malformed or paginated native app lists", async () => {
  for (const listing of [
    { apps: [app] },
    { apps: null },
    { error: {} },
    { nextPageToken: "unused", apps: [] },
    { apps: [{ appId: "foreign-project", packageName: "unused" }] },
  ]) {
    const { service, calls } = registry([[collection, response(listing)]]);
    await assert.rejects(service.inspect());
    await assert.rejects(service.create(apiKeyId), /baseline/);
    assert.deepEqual(
      calls.map(([method]) => method),
      ["GET"],
    );
  }
});

test("an immediate Firebase remove with no operation name confirms the exact app tombstone", async () => {
  const { service, calls } = registry([
    [collection, response({ apps: baseline })],
    [collection, response({ name: "operations/sample/create", done: true, response: app })],
    [resource, response(app)],
    [resource, response(app)],
    [resource + ":remove", response({ done: true, response: { ...app, state: "DELETED" } })],
    [collection, response({ apps: baseline })],
  ]);
  await service.inspect();
  await service.create(apiKeyId);
  await service.remove();
  assert.equal(calls.at(-1)[1], collection);
  assert.equal(service.assertClosed(), true);
});
