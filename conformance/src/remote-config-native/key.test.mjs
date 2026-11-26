import assert from "node:assert/strict";
import { test } from "node:test";
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

function world({ ambiguousCreate = false, conflict = false } = {}) {
  const grants = { key: null, operations: new Set() };
  const calls = [];
  const transport = {
    async send(phase, url, options) {
      calls.push({ phase, url, options });
      switch (phase) {
        case "native-key-baseline":
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
        case "native-key-value":
          assert.equal(grants.key, resources);
          return response({ name: resources, keyString: key });
        case "native-key-delete":
          assert.equal(grants.key, resources);
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
  assert.ok(calls.find((call) => call.phase === "native-key-value").options.secret);
  assert.equal(control.closed(), false);
  assert.equal(await control.remove(), true);
  assert.equal(control.closed(), true);
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
