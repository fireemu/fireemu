# Portable export LevelDB block framing

This model describes the physical [LevelDB log framing](../../../crates/fireemu-core-export/src/leveldb.rs) of a list of logical record lengths. A physical frame reserves seven bytes for its header within a 32 KiB block. A shorter trailer is padded with zeros, and a record crossing blocks gets FIRST, MIDDLE and LAST fragments. A nonempty record after a trailer of exactly seven bytes starts with an empty FIRST fragment in the old block. A zero-length logical record still has a type and header.

Lean proves that splitting and emitting continuations preserve payload lengths, that full-block payloads fit their capacity, and that padding is positive and shorter than a header. It checks the exact-header and one-byte-trailer cases explicitly. The executable corpus exercises complete physical frame sequences across initial positions, payload sizes and consecutive records. The Rust test inspects type and little-endian length fields, padding bytes and actual block containment before independently reading back the original records. A damaged final record must produce an error.

The model describes frame geometry rather than calculating masked CRC-32C. Existing Rust checksum vectors pin the exact hash implementation, while the Rust replay checks a payload mutation is detected.

## Commands

```sh
cd verification/lean/export-leveldb
lake build
lake exe corpus > ../../../crates/fireemu-core-export/tests/fixtures/lean-export-leveldb.corpus
cd ../../..
cargo nextest run -p fireemu-core-export --test export_leveldb_lean_corpus
```
