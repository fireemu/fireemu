# Event record phases in Lean 4

This model specifies the single-record transition API in `crates/fireemu-core-events/src/state.rs`. It models each phase, the attempt counter, the retry due time, terminal error precedence, and the epoch comparison. The event has a fixed logical time of zero and a one-nanosecond backoff, with varying attempt limits and age windows. The event-retry model handles the general backoff formula. Payloads, worker concurrency, and outbox publication are outside this model.

`EventTransition/Theorems.lean` proves terminal stability, refusal preserving the record, attempt accounting for start and interrupt, and the early and inclusive-due retry boundaries. Attempt counter overflow is modeled at the phase level. The Rust corpus constructs records only through the public API, so it does not attempt to reach the counter's maximum by billions of deliveries.

`Main.lean` emits a tab-separated matrix of reachable record phases, actions and probe parameters. Each row includes the outcome, next phase and attempt count, and the due time or dead-letter attempt count when present. The Rust replay checks exact transition errors, outcomes, and state. The matrix exercises stale detection and retry-time overflow. It complements the existing Quint EventDelivery model of the larger scheduling system.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-events/tests/fixtures/lean-event-transition.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-events --test event_transition_lean_corpus`. The Rust replay uses the checked-in fixture alone.
