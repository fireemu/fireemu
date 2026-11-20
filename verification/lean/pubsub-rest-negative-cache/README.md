# Pub/Sub REST negative-cache decisions

This model describes the public `RestNegativeCache` operations for plain subscription resources. Input keys encode the connection and resource identity. The timestamps are supplied request-start instants whose differences fit the Rust clock representation. The armed table and recent success table each have a capacity. For ties, key order represents the ordering of the concrete cache's keys.

The Lean laws cover the half-open time window, hits preserving the original arming instant, missing scopes, and connection cleanup. The 368 corpus rows contain 51 traces, including exact 10.35-second boundaries, separate connections, projects and names, recent success exemption, a rewind, and three traces at the actual 4,096-entry capacity. The replay checks the decision and retained armed entry count after every public operation. The capacity traces share a copy of one prefilled runtime table. The exact boundary describes the emulator's deterministic choice within the recorded production timing band.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-rest-negative-cache.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-core-pubsub -E 'binary(pubsub_rest_negative_cache_lean_corpus)'`.
