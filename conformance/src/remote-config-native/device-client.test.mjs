import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyNativeExchange, verifyNativeReceipt } from "./device-client.mjs";

const request = (sequence, operation, extra = {}) => ({
  sequence,
  operation,
  phase: "request",
  ...extra,
});
const response = (sequence, operation, extra = {}) => ({
  sequence,
  operation,
  status: 200,
  phase: "response",
  ...extra,
});
function exchange() {
  return [
    request(1, "create"),
    response(1, "create"),
    request(2, "fetch"),
    response(2, "fetch", {
      etag: "ETAG_1",
      body: { entries: { native_value: "before", native_tier: "gold" }, state: "UPDATE" },
    }),
    request(3, "realtime", { body: { lastKnownVersionNumber: "9" } }),
    request(4, "fetch", { ifNoneMatch: "ETAG_1" }),
    response(4, "fetch", {
      etag: "ETAG_2",
      body: { entries: { native_value: "after", native_tier: "gold" }, state: "UPDATE" },
    }),
    {
      sequence: 3,
      operation: "realtime",
      phase: "stream",
      status: 200,
      termination: "client-disconnect",
      bodyText: '[{\n  "latestTemplateVersionNumber": "10"\n}\n',
    },
    request(5, "delete"),
    response(5, "delete", { status: 204 }),
  ];
}
const versions = { initial: "9", update: "10" };

test("native evidence requires conditional refetch, correct invalidation, and owned cleanup", () => {
  assert.equal(verifyNativeExchange(exchange(), versions), true);
  for (const [index, patch] of [
    [5, { ifNoneMatch: "UNSEEN" }],
    [7, { bodyText: '[{"latestTemplateVersionNumber":11}' }],
    [7, { bodyText: '[{"latestTemplateVersionNumber":10' }],
    [7, { bodyText: '[{"latestTemplateVersionNumber":10} replaced' }],
    [7, { termination: "upstream-error" }],
    [9, { status: 404 }],
    [3, { body: { entries: { native_value: "before", native_tier: "base" } } }],
  ]) {
    const events = exchange();
    Object.assign(events[index], patch);
    assert.equal(verifyNativeExchange(events, versions), false);
  }
  assert.equal(verifyNativeExchange(exchange().slice(0, -1), versions), false);
});

function androidValues(value, source = 2) {
  return {
    native_value: { string: value, source },
    native_tier: { string: source === 0 ? "" : "gold", source },
    unpublished_default: { string: "app default", source: 1 },
    missing_value: { string: "", source: 0 },
  };
}

test("Android requires the observed remote value, cache, changed key and confirmed deletion", () => {
  const steps = [
    { op: "settings" },
    { op: "defaults" },
    { op: "signals" },
    { op: "fetch", lastFetchStatus: -1, fetchTimeMillis: 7, values: androidValues("", 0) },
    { op: "activate", changed: true, values: androidValues("before") },
    { op: "fetch", lastFetchStatus: -1, fetchTimeMillis: 7, values: androidValues("before") },
    { op: "observe", event: { updatedKeys: ["native_value"] }, values: androidValues("before") },
    { op: "activate", changed: true, values: androidValues("after") },
    { op: "delete-installation", deleted: true },
  ];
  assert.equal(verifyNativeReceipt("android", { steps }), true);
  steps[7].values.native_value.source = 1;
  assert.equal(verifyNativeReceipt("android", { steps }), false);
});

function iosValues(value) {
  return Object.fromEntries(
    [
      ["native_value", value, 0],
      ["native_tier", "gold", 0],
      ["unpublished_default", "app default", 1],
      ["missing_value", "", 2],
    ].map(([key, string, source]) => [key, { effective: { string, source } }]),
  );
}

test("Apple requires listener keys, activation, cached fetch and a completed delete callback", () => {
  const events = [
    { stage: "initialized", error: {} },
    { stage: "beforeFetch" },
    { stage: "customSignals", error: {} },
    { stage: "forcedFetch", status: 1, error: {} },
    { stage: "activate", changed: true, error: {} },
    { stage: "afterActivate", lastFetchTime: 7, values: iosValues("before") },
    { stage: "cachedFetch", status: 1, error: {} },
    { stage: "afterCachedFetch", lastFetchTime: 7, values: iosValues("before") },
    { stage: "realtimeListening" },
    { stage: "realtimeUpdate", keys: ["native_value"], error: {} },
    { stage: "realtimeActivate", changed: true, error: {} },
    { stage: "afterRealtimeActivate", values: iosValues("after") },
    { stage: "installationDelete", error: {} },
    { stage: "done" },
  ];
  assert.equal(verifyNativeReceipt("ios", { events }), true);
  assert.equal(verifyNativeReceipt("ios", { events: events.slice(0, -1) }), false);
  events[9].keys.push("native_tier");
  assert.equal(verifyNativeReceipt("ios", { events }), false);
});
