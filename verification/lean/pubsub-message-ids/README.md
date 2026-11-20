# Pub/Sub message IDs in Lean 4

This reference describes the three generators and runtime position update in [pubsub_message_id.rs](../../../crates/fireemu-core-types/src/pubsub_message_id.rs). It models the emulator's deterministic permutation and decimal ID range. The range is an emulator choice based on examples in the recorded production fixtures.

## Properties

- A checked modular inverse recovers a broker counter's residue. Equality of numeric IDs is equivalent to equality of residues modulo the full span. Every result has 17 decimal digits.
- The valid broker counters use the lower half of the permutation's input positions. Both runtime paths use only upper-half positions. This proves separation between broker and runtime IDs even at the join and the wrap.
- The unseeded runtime path treats zero as one and repeats after the half span for positive counters. The seeded path repeats after the half span for every counter. Its multiplier is coprime to the half span, so it cannot repeat within one session at a gap smaller than the period.
- Position updates stay within the half span and compose under addition. The model uses unbounded arithmetic for the widened sum before reduction.
- The seeded reference includes the two wrapping SplitMix64 draws, both halves of the session word, and the multiplier's adjustment away from multiples of five.

The broker partition assumes counters in `1..=BROKER_SPAN`. The arbitrary-counter oracle covers the public arithmetic, while admission limits are the broker's responsibility. The distinct-session case has no universal collision-freedom guarantee and no probabilistic assertion.

## Reproduce the corpus

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-pubsub-message-ids.corpus
```

Run `cargo nextest run -p fireemu-core-types -E 'binary(pubsub_message_ids_lean_corpus)'` from the repository root. The Rust test checks all three generators and the position update on the full boundary matrix of sessions, counters and counts. Rust does not need Lean to read the checked-in corpus.
