# Core JSON parsing in Lean 4

This reference covers the deterministic JSON reader in [core JSON](../../../crates/fireemu-core-types/src/json.rs). Its immutable cursor describes token consumption and counts offsets in UTF-8 bytes. The recursive value grammar checks the depth at entry and preserves the distinction between exact signed integers and floating-point tokens. The latter is a tag in this model. Binary floating-point rounding remains a Rust library behavior.

The string model includes JSON's ASCII escape table, four hexadecimal digits, and UTF-16 surrogate pairs. Lean proves the pair maps into the supplementary Unicode range. The oracle also predicts the precise byte position of malformed escapes and trailing data. Associative object updates replace previous values of the same decoded key. The last spelling wins after unescaping, and changing one key preserves other lookups.

The generator crosses leading whitespace, container position, and lexeme. Additional cases exercise signed integer bounds, invalid tokens, exact nesting boundaries, and decoded duplicate object keys. The ASCII hex envelope preserves control characters and whitespace in the fixture. The model's structural recursion is fuel-bounded by the input length. A fuel error is distinct from the modeled parser errors.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-core-json.corpus
```

Run `cargo nextest run -p fireemu-core-types -E 'binary(core_json_lean_corpus)'` from the repository root. The Rust replay uses `json::parse` and `JsonValue::get` and checks exact type, value, byte offset, and diagnostic for the modeled cases.
