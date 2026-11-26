import assert from "node:assert/strict";
import { test } from "node:test";
import { runNativePass } from "./program.mjs";

function world({
  badPlatform = null,
  notReady = false,
  stop = false,
  preparationFails = false,
} = {}) {
  const calls = [];
  const client = (platform) => ({
    async start(config) {
      assert.equal(config.platform, platform);
      calls.push(`${platform}-start`);
    },
    async waiting() {
      calls.push(`${platform}-stream`);
      return !(notReady && platform === "ios");
    },
    async result() {
      calls.push(`${platform}-result`);
      return { complete: badPlatform !== platform };
    },
    async finish() {
      calls.push(`${platform}-finish`);
      return { cleanupVerified: badPlatform !== platform };
    },
  });
  const ctx = {
    clients: { android: client("android"), ios: client("ios") },
    stopped: () => stop,
    async prepare() {
      calls.push("prepare");
      if (preparationFails) throw new Error("unsettled preparation");
      return { android: { platform: "android" }, ios: { platform: "ios" } };
    },
    async publish(stage) {
      calls.push(stage);
    },
    async restore() {
      calls.push("restore");
      return true;
    },
    async cleanup(cleanClients) {
      calls.push("cleanup-" + cleanClients.join("+"));
      return cleanClients.length === 2;
    },
  };
  return { calls, ctx };
}

test("the changed publication waits for both actual SDK streams and cleanup follows both clients", async () => {
  const { calls, ctx } = world();
  const result = await runNativePass(ctx);
  assert.deepEqual(result, {
    complete: true,
    sandboxAtBaseline: true,
    open: [],
    verified: ["android", "ios"],
  });
  assert.deepEqual(calls, [
    "prepare",
    "initial",
    "android-start",
    "ios-start",
    "android-stream",
    "ios-stream",
    "update",
    "android-result",
    "ios-result",
    "android-finish",
    "ios-finish",
    "restore",
    "cleanup-android+ios",
  ]);
});

test("a missing stream or stop after readiness prevents the update and still restores the sandbox", async () => {
  for (const state of [{ notReady: true }, { stop: true }]) {
    const { ctx, calls } = world(state);
    const result = await runNativePass(ctx);
    assert.equal(result.complete, false);
    assert.equal(result.sandboxAtBaseline, true);
    assert.ok(!calls.includes("update"));
    assert.ok(calls.includes("restore"));
    assert.ok(calls.includes("cleanup-android+ios"));
  }
});

test("an unsettled installation keeps its own app eligible for recovery and does not close the pass", async () => {
  const { calls, ctx } = world({ badPlatform: "ios" });
  const result = await runNativePass(ctx);
  assert.equal(result.complete, false);
  assert.equal(result.sandboxAtBaseline, false);
  assert.equal(calls.at(-1), "cleanup-android");
  assert.match(result.open.join(" "), /ios.*cleanup/);
});

test("failed preparation launches neither SDK and runs only administrative cleanup", async () => {
  const { calls, ctx } = world({ preparationFails: true });
  const result = await runNativePass(ctx);
  assert.equal(result.complete, false);
  assert.deepEqual(calls, ["prepare", "restore", "cleanup-android+ios"]);
});
