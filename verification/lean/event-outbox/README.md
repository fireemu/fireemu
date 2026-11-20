# Event outbox in Lean 4

This model specifies the public event container in `crates/fireemu-core-events/src/outbox.rs`. The reference stores retained records in a list and recomputes its views. Pending records use logical-time and event-ID order, queue views filter that order, and retries use due-time and event-ID order. Retired records use terminal-transition order and keep at least one record.

`EventOutbox/Theorems.lean` proves the dispatch relation is a total transitive ordering and the pending and queue views contain exactly the relevant entries. It also proves the retention bound, preservation below the bound, and duplicate enqueue preserving the record and every view. The model omits payloads, outbox publication, worker concurrency, epoch sweeps, and counter overflow. Fine-grained retry policy and event phases have separate Lean packages.

`Main.lean` emits tab-separated combinations of retention, queue shape, event-time order, and a bounded dispatch, retry, or eviction program. Every step records its command, result, and public state projections after the command. The Rust replay compares ordered pending IDs, each queue's head and strict successor, due IDs at time boundaries, record phases, visit counts and eviction counts. The retry trace includes ties and different due times, and the eviction trace retries an ID once its diagnostic record may have been evicted.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-events/tests/fixtures/lean-event-outbox.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-events --test event_outbox_lean_corpus`. The Rust replay uses the checked-in fixture alone.
