# App Check header and debug-token syntax in Lean 4

This package specifies two deterministic input checks, the transport-neutral App Check header classifier in `crates/fireemu-core-app-check/src/header.rs` and debug-token text normalization in `exchange.rs`. The first consumes the list of field instances selected by the header name and classifies the entire list. A single value must be nonempty visible ASCII without a comma and fit the 16 KiB limit. The second uses a segmented UUID grammar to specify layout, hexadecimal case, version 4, and the RFC variant.

## Proofs and coverage

The theorems establish the exact single-field presence condition, unconditional rejection of duplicate values and oversized input, preservation of collection order, and the shape of normalized output. `Axioms.lean` guards the permitted axioms. The fixture covers exact header values, mixed field-name spelling, duplicate folds, controls, UTF-8 substitutions, both token cases, forbidden UUID versions and variants, and misplaced separators.

The model does not make a claim about app registration, secret lookup, digest comparison, JWT signature validation, or service admission after classification.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-app-check/tests/fixtures/lean-app-check-admission.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-app-check --test integration app_check_admission_lean_corpus`. Header rows contain the name, count, sample, and classification. UUID rows contain the variant and shape labels, literal input, and canonical text or refusal. All values are synthetic. The replay requires no Lean executable.
