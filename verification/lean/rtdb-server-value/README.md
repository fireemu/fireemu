# Realtime Database server values in Lean 4

The model resolves timestamps and increments from an explicit clock and an optional stored number. An absent or nonnumeric base yields the delta. An in-range integer sum stays an integer. Other numeric cases use Lean's binary64 model, with an overflowing sum clamped to the largest finite value of its sign.

Lean proves the integer branch under the signed-64 bounds, the missing-base result, the separation of timestamp and increment dependencies, and refusal of malformed operations. The corpus checks exact IEEE 754 bits and distinguishes integer and double representations. The Rust replay inserts each case at the root, an object member, an array index, a `.value` member or a priority. Priority placeholders read the stored priority, while a `.value` placeholder reads the stored location. The model addresses these slots through fixture construction. Arbitrary recursive JSON and post-resolution tree admission are outside its scope.

The corpus holds 720 combinations of operation, base, slot and injected clock. The last field is `error`, an `i:`-prefixed integer, or a `d:`-prefixed unsigned double bit pattern. It covers both integer overflows, both signs of double saturation, signed zero and malformed shapes.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-database/tests/fixtures/lean-rtdb-server-value.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-database --test rtdb_server_value_lean_corpus`.
