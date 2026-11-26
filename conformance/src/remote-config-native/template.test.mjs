import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeTemplateControl } from "./template.mjs";

const url = "https://sandbox.invalid/v1/projects/demo-native/remoteConfig";
const initial = { version: { versionNumber: "50" } };
const published = (current, data) => ({
  ...data,
  version: { ...data.version, versionNumber: String(current) },
});
const answer = (json, etag) => ({ status: 200, json, etag });

function world({ loseResponse = false, outsideWrite = false, stopBeforeSend = false } = {}) {
  const calls = [];
  let stopped = false;
  let json = initial;
  let version = 50;
  let etag = "etag-50";
  const transport = {
    async send(phase, target, { method = "GET", body, ifMatch, beforeDispatch } = {}) {
      if (stopBeforeSend && phase === "native-initial") stopped = true;
      await beforeDispatch?.();
      calls.push({ phase, method, ifMatch, body, target });
      if (method === "GET") {
        if (outsideWrite && phase === "native-owned-cleanup")
          return answer({ ...json, version: { versionNumber: "58" } }, "etag-58");
        return answer(json, etag);
      }
      assert.equal(ifMatch, etag);
      version++;
      etag = "etag-" + version;
      json = published(version, method === "PUT" ? body : initial);
      if (method === "PUT" && loseResponse) throw new Error("write answer lost");
      return answer(json, etag);
    },
  };
  return {
    calls,
    control: nativeTemplateControl({ transport, url, runId: "examplerun", stopped: () => stopped }),
  };
}

test("publications are chained by verified ETags and restore the exact empty baseline", async () => {
  const { calls, control } = world();
  assert.equal(await control.baseline(), "50");
  assert.equal(await control.publish("initial"), "51");
  assert.equal(await control.publish("update"), "52");
  assert.equal(await control.restore(), true);
  const mutations = calls.filter((call) => call.method !== "GET");
  assert.deepEqual(
    mutations.map((call) => call.ifMatch),
    ["etag-50", "etag-51", "etag-52"],
  );
  assert.equal(mutations[0].body.parameters.native_value.defaultValue.value, "before");
  assert.equal(mutations[1].body.parameters.native_value.defaultValue.value, "after");
  assert.deepEqual(mutations[2].body, { versionNumber: "50" });
  assert.equal(mutations[2].target, url + ":rollback");
});

test("the credential-time stop prevents a request and leaves an empty baseline", async () => {
  const { calls, control } = world({ stopBeforeSend: true });
  await control.baseline();
  await assert.rejects(control.publish("initial"), /halted/);
  assert.equal(await control.restore(), true);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("unknown writes and foreign templates never authorize automatic rollback", async () => {
  for (const options of [{ loseResponse: true }, { outsideWrite: true }]) {
    const { calls, control } = world(options);
    await control.baseline();
    if (options.loseResponse) await assert.rejects(control.publish("initial"), /lost/);
    else await control.publish("initial");
    assert.equal(await control.restore(), false);
    assert.ok(!calls.some((call) => call.target.endsWith(":rollback")));
  }
});
