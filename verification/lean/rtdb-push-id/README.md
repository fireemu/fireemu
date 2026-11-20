# Realtime Database push IDs in Lean 4

A push ID consists of eight timestamp digits and twelve suffix digits, all in the same ascending radix-64 alphabet. The model steps a timestamp and numeric suffix independently of how a new suffix is drawn. The corpus instantiates the fresh-suffix input with a wrapping SplitMix64 generator using the same public seed contract as Rust.

Lean proves the widths, the suffix range and strict increase of the combined timestamp-and-suffix rank while both timestamps fit in eight digits. It also checks a counterexample at the boundary. At an exhausted suffix under the largest eight-digit timestamp, Rust advances the internal timestamp and encodes only its low 48 bits, reversing the usual order. The corpus pins this current behavior. Arbitrary malformed internal state and Rust integer overflow at the maximum 64-bit timestamp are outside the model.

The corpus crosses three clock relations, three suffix shapes, three timestamp boundaries and three seeds. Each row records both expected IDs, plus the request and previous generator state. The Rust test calls the public state constructor, `current` and `next`.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-database/tests/fixtures/lean-rtdb-push-id.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-database --test rtdb_push_id_lean_corpus`.
