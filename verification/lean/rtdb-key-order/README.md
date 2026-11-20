# Realtime Database keys in Lean 4

This model specifies the string grammar and comparison in `fireemu_core_database::key`. An eligible numeric spelling denotes a signed 32-bit integer. Within that class, the order compares quantity, spelling length and UTF-16 units in sequence. Text keys sort after numeric keys and by UTF-16 units among themselves. The grammar check separately handles an empty name, the forbidden punctuation and ASCII controls.

Lean proves that accepted numeric spellings fit the signed range, numeric keys precede text keys, and text keys use UTF-16 order. The encoding lemmas distinguish supplementary Unicode characters from one-unit characters. In particular, U+10000 sorts before U+E000 despite having a larger scalar value. These proofs cover the model. Rust does not call Lean at build time.

The corpus holds 72 numeric grammar rows, 625 ordered pairs and 153 validation rows. Every string is a comma-separated list of Unicode scalar values, with an empty field for the empty string. Comparison rows also carry the independent UTF-16 comparison result.

## Reproduce

From this directory, build the proofs and generate the corpus.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-database/tests/fixtures/lean-rtdb-key-order.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-database --test rtdb_key_order_lean_corpus`.
