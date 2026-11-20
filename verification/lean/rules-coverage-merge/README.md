# Bounded Security Rules coverage aggregation

The model covers integer-valued observations at a single expression extent in `crates/fireemu-core-rules/src/coverage.rs`. A summary retains the first distinct witnesses up to its capacity, increments a retained witness in place, and counts other observations as omitted. Merge applies each retained count in source order and then adds the source's omitted count. Aggregate counters saturate at the unsigned 64-bit maximum.

The guarded proofs establish that merge preserves a bounded left summary, that merge with an empty right summary is its identity, and that repeated observations leave witness order unchanged. Merge is not associative. If the middle summary is full, merging into it first can omit an observation that the left summary would otherwise count against a retained witness. Lean proves this distinction at a capacity of two, and the corpus reproduces it at the implementation capacity of 64. Do not regroup accumulating summaries if exact diagnostic witness counts must stay the same.

The Rust replayer exercises `record`, `merge`, `trace_entries`, and `omitted_at`, checks exact order and counts under both groupings, and verifies that a second extent stays independent. The model does not cover UTF-8 truncation, noninteger equality, implementation caches, bare-record counter overflow, or the diagnostics request ring.

## Replay

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-coverage-merge.corpus
cargo test -p fireemu-core-rules --test rules_coverage_merge_lean_corpus
```
