# Concrete Security Rules scalar sets

The model describes membership of concrete nulls, booleans, strings, signed integers, floats on the exact half-unit grid, signed zero, and NaN. Integer and float values alias when exactly equal, so the integer adjacent to a representable float beyond 2^53 stays distinct. NaN has no equality key and does not equal itself. Repeated NaNs still occupy separate entries in a set.

`RulesSetValues/Spec.lean` proves that equality coincides with a shared key, deduplication preserves membership, and the membership laws for union, intersection and difference. The key is a mathematical value, independent of the runtime hash fingerprint. Existing Kani harnesses in `verification/kani/src/lib.rs` check the Rust scalar keys against IEEE 754 comparisons. The Lean replayer exercises the actual Rules set operators end to end on exact dyadic examples. Arbitrary floats, nested structural values and query-proof equality are outside this model.

## Replay

Each row identifies the two value families and the small or wide collection regime, followed by the two encoded inputs, a probe, five cardinalities, and four membership or subset answers. In the wide regime the common integer suffix crosses the production evaluator's membership index thresholds. NaN-containing collections additionally exercise the fallback path. The replayer uses document values so both the float and integer representations reach the evaluator intact.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-set-values.corpus
cargo test -p fireemu-core-rules --test rules_set_values_lean_corpus
```
