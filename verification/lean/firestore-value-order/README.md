# Firestore value order in Lean 4 (pilot)

A Lean 4 specification of the Firestore value order implemented by `Value::canonical_cmp`
in `crates/fireemu-core-firestore/src/value.rs`, machine-checked proofs that it is a total
preorder, and an executable reference that writes the golden corpus the Rust tests compare
against. The Rust build and tests do not need Lean.

## Layout

- `FirestoreValueOrder/Laws.lean`: pointwise order laws (`Refl`, `Swap`, `Trans`) and the
  building blocks (`cmpInt`, `pairCmp`, `lex`, `comap`) with their proofs.
- `FirestoreValueOrder/Spec.lean`: the abstract value type `Val`, the specified comparator
  `cmp`, and `cmp_laws` (all three laws at every value, including nested arrays and maps),
  with the usual forms `cmp_refl`, `cmp_swap`, `cmp_le_trans`, `cmp_lt_trans`,
  `cmp_eq_trans` and `cmp_total`.
- `FirestoreValueOrder/Concrete.lean`: `RValue`, which mirrors the Rust `Value`
  (`i64`, `f64` bit patterns, strings), its exact abstraction `toVal`, and the documented
  equalities `nan_eq_nan`, `neg_zero_eq_zero`, `one_eq_one_point_zero`, `nan_lt_neg_inf`.
- `FirestoreValueOrder/Axioms.lean`: a build-time guard that the theorems depend only on
  Lean's standard axioms (no `sorry`).
- `Main.lean`: the corpus generator.

## Number model

Every finite `f64` and every `i64` is an integer multiple of `2^-1074`, so a finite number
is represented by the `Int` `x * 2^1074` and numbers compare as `Int`s. The infinities are
separate constructors, and NaN is its own type, below every number. `dblOfBits` converts an
`f64` bit pattern exactly.

## Commands

The toolchain is pinned in `lean-toolchain`; `elan` downloads it on first use.

```sh
lake build                 # checks every proof and builds the generator
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-value-order.corpus
```

The Rust side is `crates/fireemu-core-firestore/tests/value_order_lean_corpus.rs`: it reads
the corpus and checks every pair against `canonical_cmp`, and states the same order laws as
proptest properties. Regenerate the corpus after changing `Main.lean` or the specification,
and commit both.
