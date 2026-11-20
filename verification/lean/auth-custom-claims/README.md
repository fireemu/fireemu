# Auth custom claims in Lean 4

This package models the two presentations of `CustomClaims` in `crates/fireemu-core-auth/src/claims.rs`. A parsed object retains its original text, with whitespace and member order intact, until a successful replacement or removal. A rejected insertion or a removal of an absent member leaves that presentation unchanged. A constructed claim set and a successfully mutated claim set use canonical JSON. An empty set with no preserved source does not report an attributes field.

The size budget is 1,000 inclusive UTF-8 bytes of the retained source when available or canonical JSON otherwise. The model renders a sorted map of encoded values and defines escaping for JSON string scalars. Corpus rows cross source formatting, scalar widths, mutation outcomes, and values near the budget. Literal cases check exact UTF-8 output, including empty objects, escaping, and sort order. The model covers the selected scalar and object shapes. General JSON parsing, nested values, float formatting, and Blocking Auth adapters retain their separate tests.

The size theorem isolates the output whose consumed byte count matters. It provides a reference for evaluating a future length-only encoder without changing the canonical representation.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-auth/tests/fixtures/lean-auth-custom-claims.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-auth --test auth_custom_claims_lean_corpus`. Trace rows describe a public construction and mutation, presentation kind, both byte counts, size verdict, and selected entry. Literal rows encode exact JSON text as hexadecimal bytes.
