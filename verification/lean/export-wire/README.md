# Protobuf varints for portable export

This model describes the base-128 varints used by [the portable export wire codec](../../../crates/fireemu-core-export/src/wire.rs). The canonical writer encodes the positional base-128 expansion in little-endian digit order with a continuation flag on every nonfinal digit. Proto2 signed fields encode the unsigned two's-complement bit pattern. The scope is varint wire tags and payloads. Fixed-width, delimited and group fields have separate parsers.

Lean proves that a value fitting within the selected digit budget decodes to that value and consumes exactly the emitted bytes, even when another field follows. Every unsigned 64-bit value fits the ten-byte budget, and signed reinterpretation preserves each 64-bit pattern. The model also records the reader's current behavior for redundant encodings and tenth-byte payloads. A terminal byte can carry more than one value bit in position ten, and the Rust result retains only the low 64 bits. An unterminated tenth byte is an error. These are codec observations, independent of any production service acceptance claim.

The corpus crosses tag-length and integer boundaries, covers every seven-bit magnitude transition and contains finite malformed and noncanonical cases. Rust checks the exact emitted bytes, decoded value, cursor consumption and diagnostic kind through public APIs. The Lean build checks the axioms of each stated theorem.

## Commands

```sh
cd verification/lean/export-wire
lake build
lake exe corpus > ../../../crates/fireemu-core-export/tests/fixtures/lean-export-wire.corpus
cd ../../..
cargo nextest run -p fireemu-core-export --test export_wire_lean_corpus
```
