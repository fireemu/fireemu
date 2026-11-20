# CRC-32C in Lean 4

The reference implements the reflected Castagnoli polynomial, initial all-ones state and final complement. Each byte advances the polynomial eight times. The theorems prove that appending bytes or partitioning them into chunks preserves the exact result for every initial state. The empty checksum and the standard `123456789` check value are proved by evaluation.

The corpus crosses byte count, unaligned starting offset, and update chunk width. Rust calls both `crc32c` and `Crc32c` from `fireemu-core-types`. It exercises the available backend on the current host and compares it with the bit-by-bit reference. The model makes no claim about hardware dispatch or CRC collision resistance.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-crc32c.corpus
cargo test -p fireemu-core-types --test crc32c_lean_corpus
```
