# Bounded adapter notices in Lean 4

The reference retains the first 32 distinct observed names and emits at most one suppression marker when a further distinct name arrives. The theorems prove the retained-name bound, silence for duplicates and irreversible suppression. A corpus starting from a fresh public limiter compares every reported event, including the exact capacity boundary and repeat-after-stop cases.

~~~sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-support/tests/fixtures/lean-adapter-notice-limit.corpus
cargo test -p fireemu-adapter-support --test adapter_notice_limit_lean_corpus
~~~
