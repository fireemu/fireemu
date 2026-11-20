# Session fault selection in Lean 4

This model specifies rule selection and retained history from `crates/fireemu-core-session/src/fault.rs`. The reference counts earlier calls directly. A function restriction narrows the occurrence count, but an event restriction only controls whether the rule fires. Every matching action is retained in rule order, even when two rules return identical actions. The history is the newest suffix of all fired records.

The model treats actions as opaque identifiers and uses distinct operation and function names without the separator used in the Rust counter key. It does not drive adapter effects, shared registries, or counter overflow. `SessionFault/Theorems.lean` proves ordered selection, overlap retention, absence of observations without a plan, history length and conservation, and occurrence counting across different event types.

`Main.lean` emits tab-separated rows for all plan, operation, function and event shape combinations after a fixed first call. Rows record returned actions, fired records, and counters. Additional rows drive the 1,000-record boundary and two-action eviction through the public state. The Rust run compares the entire retained deque and checks that installing or clearing a plan resets it.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-session/tests/fixtures/lean-session-fault.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-session --test session_fault_lean_corpus`. The Rust replay uses the checked-in fixture alone.
