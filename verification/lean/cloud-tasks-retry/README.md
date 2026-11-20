# Cloud Tasks retry policy

An attempt at the configured limit can still retry. A missing or zero elapsed budget leaves the attempt limit in charge. A positive budget permits further retries until both the attempt and elapsed limits have been strictly exceeded. The theorems show these boundaries and the behavior of the declared-gap cap and production gap floor.

The declared-gap reference computes the exponential-to-linear formula in natural numbers. The corpus configurations keep intermediate values small enough for exact integer representation in the Rust floating-point calculation, even at the largest u32 attempt. The replayer also tests each production-floor transition. This scope excludes arbitrary floating-point configurations, retries after successful dispatch, and queue scheduling.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-cloud-tasks-retry.corpus
```

From the repository root, run `cargo test -p fireemu-adapter-functions --test cloud_tasks_retry_lean_corpus`.
