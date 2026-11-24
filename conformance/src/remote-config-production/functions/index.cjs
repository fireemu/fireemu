// Raw Remote Config handlers for the local side of the production comparison: like the production
// handlers (src/remote-config-observe/function/index.cjs, functions-framework 3.5.0 without the
// firebase-functions SDK), they record the arguments the runtime passes, unchanged, so both sides
// observe the same layer (coordinator ruling 4). The `__endpoint` declarations are what
// firebase-functions would emit for remoteConfig.onUpdate (v1) and onConfigUpdated (v2).
const fs = require("node:fs");

function record(generation, args) {
  const row = { generation, receivedAt: new Date().toISOString(), args };
  if (process.env.REMOTE_CONFIG_OUTPUT)
    fs.appendFileSync(process.env.REMOTE_CONFIG_OUTPUT, JSON.stringify(row) + "\n");
}

exports.rcObserveV1 = (data, context) => record(1, [data, context]);
exports.rcObserveV1.__endpoint = {
  platform: "gcfv1",
  eventTrigger: {
    eventType: "google.firebase.remoteconfig.update",
    eventFilters: { resource: `projects/${process.env.GCLOUD_PROJECT}` },
    retry: false,
  },
};

exports.rcObserveV2 = (...args) => record(2, args);
exports.rcObserveV2.__endpoint = {
  platform: "gcfv2",
  eventTrigger: {
    eventType: "google.firebase.remoteconfig.remoteConfig.v1.updated",
    eventFilters: {},
    retry: false,
  },
};
