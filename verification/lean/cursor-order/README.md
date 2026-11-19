# Firestore query ordering and cursors in Lean 4

This project checks the agreement between `Query::effective_order_by`, the two store comparison loops, the cursor bounds and `FirestoreState::cursor_after_document`. The Rust test replays the generated expectations without a Lean dependency.

## Specification and proofs

- `CursorOrder/Spec.lean` gives the declarative contracts. `LayoutSpec` describes the explicit prefix and the ordered subsequence of implicit inequalities. `EffectiveSpec` states field uniqueness and the final name direction. `lexSpec` selects the first non-equal directed projection. `BoundSpec` specifies membership on each side of that position.
- `CursorOrder/Model.lean` models the Rust functions separately. A borrowed key slot holds either a stored value or a document path. Key-to-key and key-to-value comparison dispatch separately. The scans stop at the shortest input. A missing ordered field prevents key construction. Cursor construction takes the versioned lookup, scope verdict and filter result as inputs, propagates an evaluated filter error, checks both existing bounds, and returns the complete exclusive cursor on success.
- `CursorOrder/Value.lean` and `ValueLaws.lean` contain the abstract comparator and its laws from the standalone Firestore value-order project. A reference is a list of UTF-8 byte segments including the project, database and documents prefix. `rendered_name_value` proves that rendering and splitting a valid resource name preserves its segments.
- `CursorOrder/Theorems.lean` proves `effective_layout`, `effective_fields`, `effective_name` and `effective_well_formed`. The input inequalities are the canonically ordered, distinct field paths returned by `inequality_fields`. The uniqueness theorem requires distinct explicit fields. When an explicit name exists it must be last and all non-name inequalities must already be explicit.
- `keys_spec` identifies the key comparison with the declarative order. `keys_laws`, `document_total_order` and `effective_distinct` establish reflexivity, reversal on swapping operands, totality, transitivity and separation of different document names. `reverse_keys` reverses every effective direction, including the name clause.
- `full_cursor` relates both comparison loops. `prefix_cursor` applies to arbitrary cursor values and `prefix_document` equates a document-derived prefix with the declarative order restricted to those clauses. `bound_spec` and `bounds_partition` prove the four boundary conventions on every key. The partition applies to documents eligible for ordering. For example, `items/b` has no field `a`, so neither half of a query ordered by `a` returns it (`missing_field_no_cursor`).
- `present_key`, `build_iff`, `built_cursor`, `start_after` and `start_after_built` connect successful construction to the returned cursor and the strict suffix after its document. Offset and limit do not enter cursor construction. The separate production validation of name operands and unrelated query refusals are outside these ordering functions.
- `CursorOrder/Axioms.lean` guards the dependencies of every named theorem, including the local copies of the value-order laws.

## Findings

1. With `ORDER BY __name__ DESC` and an inequality on `b`, the raw order is `(__name__ DESC, b DESC)`. With `ORDER BY __name__ ASC, a DESC`, the name also keeps its original ascending direction. Both profiles refuse a clause after the name (`explicit_name_before_inequality`, `name_before_last_explicit`).
2. With `ORDER BY a ASC, a DESC`, the raw order is `(a ASC, a DESC, __name__ DESC)`. Production canonicalization refuses the duplicate. Emulator canonicalization accepts it (`duplicate_explicit_field`). With `ORDER BY __name__ DESC, __name__ ASC`, the raw order contains two name clauses. Production reports a duplicate and the emulator reports a clause after the name (`repeated_name`).
3. With no explicit order, a document yields a one-reference exclusive cursor. The comparison accepts that cursor and the emulator permits it. Production canonicalization counts only explicit clauses and refuses arity one against zero (`implicit_cursor_arity`). The suffix theorem concerns store execution with a successfully built cursor.

## Corpus and commands

`Main.lean` documents the line format and the six-document collection group. Among the documents, `p/a/items/z` and `p/a!/items/z` tie on every stored field and share their leaf ID. They distinguish segment order from flat string order. Each case records raw effective clauses, both canonicalization verdicts, and, for accepted emulator queries, the ordered results and exact cursor values. The Rust replay checks cursor absence for every excluded fixture as well.

Run these commands in this directory with the pinned toolchain installed.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-cursor-order.corpus
```

`crates/fireemu-core-firestore/tests/cursor_order_lean_corpus.rs` drives the private comparison and admission functions through public versioned store queries, and checks returned cursors through the public builder. Its proptest varies field values, directions, explicit names, pivot documents and prefix lengths.

## Open

No outstanding proof obligations. Private comparisons are observed through ordered results and bounds on keys reachable from stored documents.
