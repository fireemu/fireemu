import assert from "node:assert/strict";
import { test } from "node:test";
import { API_TARGETS } from "../remote-config-web/program.mjs";
import { nativeKeyControl } from "./key.mjs";

const name = "fixture-stage-c";
const number = "100000000004";
const key = "AIza" + "0".repeat(35);
const root = "https://apikeys.googleapis.com/v2/";
const keys = root + "projects/demo-native/locations/global/keys";
const uid = "934c1011-e912-4c1e-8f5f-e2097dbc71f9";
const resources = `projects/${number}/locations/global/keys/${uid}`;
const deleteTime = "2026-11-26T02:21:20Z";
const urls = { keysList: keys, keysCreate: keys, keysApi: root };
const response = (json) => ({ status: 200, json });

function world({
  ambiguousCreate = false,
  conflict = false,
  reusedKey = false,
  wrongTargets = false,
} = {}) {
  const grants = { key: null, operations: new Set() };
  const calls = [];
  const transport = {
    async send(phase, url, options) {
      calls.push({ phase, url, options });
      switch (phase) {
        case "native-key-baseline":
          return response(
            reusedKey ? { keys: [{ name: resources, displayName: "preexisting" }] } : {},
          );
        case "native-key-baseline-after":
          return response({});
        case "native-key-create": {
          if (ambiguousCreate) throw new Error("create answer lost");
          return response({ name: "operations/key-create" });
        }
        case "native-key-create-poll-1":
          assert.ok(grants.operations.has("operations/key-create"));
          return response({
            name: "operations/key-create",
            done: true,
            response: { name: resources, displayName: name, uid },
          });
        case "native-key-owned":
          return response({
            name: resources,
            uid,
            displayName: name,
            restrictions: {
              apiTargets: (wrongTargets
                ? [...API_TARGETS, "other.googleapis.com"]
                : API_TARGETS
              ).map((service) => ({ service })),
            },
          });
        case "native-key-value":
          assert.equal(grants.key, resources);
          return response({ name: resources, keyString: key });
        case "native-key-delete":
          assert.equal(grants.key, resources);
          return response({
            name: "operations/key-delete",
          });
        case "native-key-delete-poll-1":
          assert.ok(grants.operations.has("operations/key-delete"));
          return response({
            name: "operations/key-delete",
            done: true,
            response: { name: resources, deleteTime },
          });
        case "native-key-after":
          return response({
            name: resources,
            displayName: name,
            ...(conflict ? {} : { deleteTime }),
          });
        default:
          throw new Error("unplanned key request");
      }
    },
  };
  return {
    control: nativeKeyControl({ transport, grants, urls, number, name, pause: () => {}, polls: 2 }),
    calls,
  };
}

test("the key is restricted and its value is never selected for persistence", async () => {
  const { control, calls } = world();
  assert.deepEqual(await control.create(), { value: key, uid });
  const create = calls.find((call) => call.phase === "native-key-create");
  assert.deepEqual(
    create.options.body.restrictions.apiTargets.map((entry) => entry.service).toSorted(),
    [
      "firebaseinstallations.googleapis.com",
      "firebaseremoteconfig.googleapis.com",
      "firebaseremoteconfigrealtime.googleapis.com",
    ],
  );
  for (const phase of [
    "native-key-create",
    "native-key-create-poll-1",
    "native-key-owned",
    "native-key-value",
  ]) {
    assert.equal(calls.find((call) => call.phase === phase).options.secret, true, phase);
  }
  assert.equal(control.closed(), false);
  assert.equal(await control.remove(), true);
  for (const phase of ["native-key-delete", "native-key-delete-poll-1", "native-key-after"]) {
    assert.equal(calls.find((call) => call.phase === phase).options.secret, true, phase);
  }
  assert.equal(control.closed(), true);
  assert.equal(calls.at(-1).phase, "native-key-baseline-after");
});

test("a missing or contradictory cleanup answer leaves the key unresolved", async () => {
  const uncertain = world({ ambiguousCreate: true });
  await assert.rejects(uncertain.control.create(), /answer lost/);
  assert.equal(await uncertain.control.remove(), false);
  assert.equal(uncertain.control.closed(), false);
  assert.ok(!uncertain.calls.some((call) => call.phase === "native-key-delete"));

  const conflict = world({ conflict: true });
  await conflict.control.create();
  assert.equal(await conflict.control.remove(), false);
  assert.equal(conflict.control.closed(), false);
});

test("an operation that names a preexisting key cannot authorize reading or deleting it", async () => {
  const { control, calls } = world({ reusedKey: true });
  await assert.rejects(control.create(), /preexisting/);
  assert.equal(await control.remove(), false);
  assert.ok(!calls.some((call) => ["native-key-value", "native-key-delete"].includes(call.phase)));
});

test("an owned key with broader API restrictions can be removed but never reaches an SDK", async () => {
  const { control, calls } = world({ wrongTargets: true });
  await assert.rejects(control.create(), /restrictions/);
  assert.ok(!calls.some((call) => call.phase === "native-key-value"));
  assert.equal(await control.remove(), true);
});
