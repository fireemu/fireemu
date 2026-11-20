# Deterministic ID streams in Lean 4

This model specifies the public `DeterministicIdSource` and `SplitMix64` behavior in [determinism.rs](../../../crates/fireemu-core-types/src/determinism.rs). Its history projection defines the ordinal of each call by counting occurrences of its kind in the prefix. The mixing functions operate on exact 64-bit words. The packed identifier pairs the derived stream key with a mixed counter.

## Properties

- Commands return consecutive ordinals before the counter wraps. Appending calls from other streams does not affect the next result of a stream.
- The SplitMix output permutation is injective. The proof reverses each right-shift XOR bit by bit, checks concrete modular inverses for both multipliers, and cancels the seed increment.
- At a fixed session and seed, the four mixed kinds occupy disjoint namespaces. Within a mixed kind, different 64-bit counter words give different IDs. Commands have their own ordinal API.
- The derived random-word stream repeats when its position advances by `2^64`. A successful bounded draw with a positive bound returns a result below the bound.
- The session fold can identify distinct sessions. In particular, the session `2^64 + 2^17` and zero give the same stream key for a fixed seed and kind. There is no global cross-session uniqueness guarantee.

The mathematical history has natural-number length, while the executable API wraps its counters at 64 bits. The bounded-draw rule models selection from a supplied word list. The fixture generator tests skipped words and the post-draw word using a finite prefix. The model does not assign a probability distribution to seeds or assert cryptographic properties.

## Reproduce the corpus

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-deterministic-id-source.corpus
```

Run `cargo nextest run -p fireemu-core-types -E 'binary(deterministic_id_source_lean_corpus)'` from the repository root. The test replays the complete session, seed and interleaving matrix and the seeded raw and bounded draw cases. The ordinary Rust tests only read the checked-in corpus.
