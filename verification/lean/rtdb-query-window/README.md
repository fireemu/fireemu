# Realtime Database query windows in Lean 4

The model selects rows by two optional bounds, sorts by the index and the key tie-breaker, then takes a prefix or suffix. This gives an oracle for the bounded query path, where the Rust engine can use a heap to avoid sorting all eligible rows. The model represents primary values and encoded keys by ranks. The corpus instantiates these ranks with numeric spellings, Unicode keys, equal values, missing children, priorities, booleans, text and objects. It exercises the public key, value, priority and child order builders.

Lean proves that every selected row was present and satisfies both bounds, each side of the limit produces the expected length, the result stays sorted, and a zero first limit produces no rows. The model covers ordering and window selection with valid parameters. Parameter validation and the complete exact floating-point ordering are separate contracts.

The corpus crosses four orders, eight bounds and five limit shapes for 160 cases. Its tab-separated fields name the order, bounds and limit, followed by the selected keys in order or `-` for an empty result. The replay also runs each query on an absent node and a leaf.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-database/tests/fixtures/lean-rtdb-query-window.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-database --test rtdb_query_window_lean_corpus`.
