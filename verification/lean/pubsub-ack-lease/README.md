# Pub/Sub acknowledgement leases

The model describes the lifecycle of one retained message under a fixed push or pull configuration. Its state records when the message is available, whether it has an outstanding acknowledgement identifier and deadline, or whether it is waiting for dead-letter completion or already acknowledged. Timestamps and durations in the corpus are in whole seconds. Pull uses the delivery clock while push uses logical time. Both clocks are explicit, and the model keeps the observed delivery time at least as large as its logical counterpart.

The Lean laws cover stale acknowledgement behavior, unchanged attempt counters on nack, inclusive lease deadlines, bounded retry delays and the allocation-free effect of forwarding on acknowledgement identifiers. The 624 corpus rows contain 48 traces that cross clock source, backoff selection, clock skew and expiry, nack, extension or forwarding scenarios. The public Rust replay checks the assigned ID, attempt and message identity, followed by the outstanding count, pending transfer count and next available time after each operation. Expiry is an explicit operation, which is also how the one-message core methods are used here. Multi-message batching, mode changes, seeks and retention reclamation use separate contracts.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-ack-lease.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-core-pubsub -E 'binary(pubsub_ack_lease_lean_corpus)'`.
