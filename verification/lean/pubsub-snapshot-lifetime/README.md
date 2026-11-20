# Pub/Sub snapshot lifetime

The reference models the lifetime and visibility of a snapshot created from a bounded backlog. The oldest unacknowledged publish time determines age. An absent backlog or a publish time ahead of the snapshot instant leaves the full lifetime. A snapshot must retain at least one hour, inclusive. A read at its exact expiry no longer sees it.

The corpus varies the age in nanoseconds, acknowledgement and retention, and the lookup instant. The Rust replayer uses the broker's public topic, subscription, snapshot, pull and acknowledgement operations. It checks the public expiry and capture sets and confirms that rejected snapshot creation does not consume a generated name. The model uses mathematical integers for the interior of the runtime's time domain. Resource limits, cross-topic seek, publication concurrency and saturation of the timestamp representation are outside its scope.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-snapshot-lifetime.corpus
```

From the workspace root:

```sh
cargo nextest run -p fireemu-core-pubsub --test pubsub_snapshot_lifetime_lean_corpus
```
