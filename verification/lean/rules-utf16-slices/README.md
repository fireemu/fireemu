# Security Rules UTF-16 selection

This model specifies the concrete string index and range operations in `crates/fireemu-core-rules/src/eval.rs`. Inputs are lists of UTF-16 units. It characterizes a split surrogate pair using the neighboring units at a range endpoint. A valid range is half-open, but its empty form is allowed only at a strictly interior position.

The official emulator profile retains a cut unit. In the production profile, a single cut half is represented by Fireemu as a nontext fragment of size one and differs from the corresponding lone escape and U+FFFD literal. A longer range that cuts a pair fails. Originally lone units are retained by both profiles. This model pins Fireemu's implementation where the production recording leaves the concrete fragment representation or longer ranges unspecified.

The guarded proofs cover the asymmetric empty-range rule, full-range identity, exact width in the official profile, boundary safety and agreement on uncut spans. The corpus varies both profiles, BMP and supplementary characters, unpaired and reversed halves, access operation, and valid or invalid endpoints. The Rust replayer checks concrete units or fragment behavior through Rules text and checks the cause reported for invalid selections. This is a model of concrete string selection, with list slicing, query proofs, other string operators, and compiler limits outside its domain.

## Replay

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-utf16-slices.corpus
cargo test -p fireemu-core-rules --test rules_utf16_slices_lean_corpus
```
