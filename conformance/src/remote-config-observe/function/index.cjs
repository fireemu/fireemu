// Disposable Remote Config event handlers for the production observation. They log the raw
// arguments the runtime passes, unchanged, as one JSON line marked with the run id.
const run = process.env.FIREEMU_RC_OBSERVE_RUN;
function record(generation, args) {
  console.log(
    JSON.stringify({
      fireemuRcObserve: run,
      generation,
      receivedAt: new Date().toISOString(),
      args,
    }),
  );
}
exports.rcObserveV1 = (data, context) => record(1, [data, context]);
exports.rcObserveV2 = (...args) => record(2, args);
