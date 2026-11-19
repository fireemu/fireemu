# Firestore storage size in Lean 4

A Lean 4 specification of the checked size calculators in `crates/fireemu-core-firestore/src/size.rs`, machine-checked proofs, and an executable reference that writes the golden corpus replayed by the Rust integration test. The Rust build and tests do not need Lean.

## Layout

- `DocumentSize/Spec.lean` defines the value and path projections, checked arithmetic, the size calculators, and the unbounded byte formulas.
- `DocumentSize/Theorems.lean` proves the formulas, arithmetic bounds, additivity, and monotonicity, and pins counterexamples and boundary behavior.
- `DocumentSize/Axioms.lean` guards every theorem at build time with `#guard_msgs in #print axioms`. The allowed dependencies are `propext`, `Classical.choice`, and `Quot.sound`.
- `Main.lean` generates the corpus and documents its format. It covers every value kind, empty and mixed containers through depth 20, UTF-8 strings and keys, references, documents at the 1 MiB threshold and one byte on either side, contributor ordering and truncation, and all four index scopes.

## Model and proofs

Values retain the information needed for sizing. Byte and vector lengths are natural numbers so the proofs can express inputs near the arithmetic limit. Document paths represent the relative segments of a constructed `DocumentPath`. Map entries have unique keys and are in Rust's UTF-8 byte order for the contributor breakdown. The breakdown models the total, name bytes, contributions, and fixed model revision and precision metadata.

`string_size_exact`, `document_name_size_exact`, `reference_size_exact`, `field_value_size_exact`, `fields_size_exact`, and `document_size_exact` give the charges. Each string costs its UTF-8 byte count plus one. A name or reference adds 16 to the segment charges. A document adds 32 to the name and field charges. A vector costs eight bytes per component. `checked_add_exact` explains why grouping nonnegative contributions differently preserves the result and overflow behavior.

`array_concat_size` and `disjoint_map_union_size` give additivity with checked addition. The disjoint union is a permutation of the concatenated entries. `array_size_monotone`, `map_size_monotone`, and `document_size_monotone` give monotonicity when the enlarged charge fits in `u64`.

`add_overflow_iff`, `value_overflow_iff`, and `document_overflow_iff` give the exact arithmetic bound. The unbounded byte charge, including keys, names, and fixed overhead as applicable, must be at most `2^64 - 1`. All intermediate charges fit under that bound.

`indexed_value_size_exact` checks the original size before charging at most 1,500 bytes for a non-reference. A reference retains its full charge. `index_entry_size_within_bound` and `index_entry_overflow_iff` give the four index formulas and the success condition. The document name, supplied parent name, each raw value used by the scope, and the final charge must fit in `u64`. A single-field scope also needs a first field. Both collection-group scopes check a supplied parent even though they omit it from the charge.

## Findings

- `empty_single_field_index_refuses` proves that both single-field scopes return `Overflow` for document `c/d`, no parent, and zero fields. This refusal occurs without arithmetic overflow. The corresponding composite cases succeed. `single_field_index_ignores_extra_fields` also shows that `[(a, null), (b, bytes(u64::MAX + 1))]` in single-field collection scope still charges 55 bytes for `c/d`, because the trailing field is ignored. The corpus exercises trailing fields with allocatable values.
- `array_append_can_overflow` proves that an array containing a byte value of length `u64::MAX` fits exactly, then appending `null` returns `Overflow`. `indexed_cap_does_not_hide_overflow` proves that indexing a vector of length `u64::MAX / 8 + 1` also returns `Overflow`, before the 1,500-byte cap can apply.
- `overlapping_map_union_can_shrink` proves that replacing key `k`'s geopoint with `null` decreases the map charge from 18 to 3. Additivity and monotonicity apply to disjoint keys.
- `document_size_accepts_above_one_mib` proves that `c/d` with field `b` containing 1,048,523 bytes returns a charge of 1,048,577 bytes. The storage-size calculator reports the charge on both sides of the write limit.
- `reference_strips_namespace_in_order` proves that `projects/documents/databases/documents/documents/c/0001` is charged on `c/0001`. `reference_fallback_keeps_empty_segments` proves that `a//b/` takes the raw path and charges 22 bytes, including the interior and trailing empty segments.

## Open

`fields_size` and `reference_size` are private. The Rust replay reaches them through `field_value_size` with maps and references. The private `add` is exercised by public size calculations. Rust's owned values cannot materialize the lengths near `u64::MAX` needed for the arithmetic counterexamples, so Lean covers those inputs directly. There are no outstanding proof obligations in the listed scope.

## Commands

The toolchain is pinned in `lean-toolchain`.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-document-size.corpus
```

`crates/fireemu-core-firestore/tests/document_size_lean_corpus.rs` checks the corpus count, replays every case through the public API, and tests the proved formulas and laws with the crate's existing proptest dev-dependency.
