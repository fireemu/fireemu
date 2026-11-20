# Pub/Sub snapshot seek reconciliation

The model restores missing captured messages that the target filter admits. It inserts the missing capture sequence before the first target entry outside the snapshot boundary and returns the pending messages in order. Snapshot membership distinguishes a captured acknowledged message from a new message published at the same instant.

The corpus varies target membership, the captured acknowledgement set, the target filter and the timestamp boundary. The replayer sets up a local subscription, obtains delivery tokens before the seek, restores the snapshot and checks ordered replay and refusal of the old tokens. Topic incarnation checks, retention-capacity refusal, concurrency and broker request error mapping are outside this package.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-snapshot-seek.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-pubsub --test pubsub_snapshot_seek_lean_corpus
```
