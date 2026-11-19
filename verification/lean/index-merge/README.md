# The index-merge decision in Lean 4

A Lean 4 model of how `crates/fireemu-core-firestore/src/index.rs` decides that a query is
served by merging indexes (`merged_indexes_for` and what it calls), a declarative
specification of when production's rules merge, machine-checked proofs relating the two, the
recorded production verdicts checked at build time, and an executable reference that writes the
golden corpus the Rust tests replay through the public `decide`. The Rust build and tests do not
need Lean.

## Scope

In: one conjunction of equality, `IS NULL`, `array-contains` and range filters (on fields or on
`__name__`) with explicit orders, through `requirement_for` and `Query::effective_order_by`;
`automatic_index_for`, `composite_fields_serve`, `merged_indexes_for` and `decide_disjunct`
with `required_index` and `missing_decision`, for every policy and edition. The single-field
configuration is the effective result of `IndexSet::single_field_modes` per collection group and
field.

Out: DNF expansion (`in`, `or` and `not-in` give several disjuncts, each decided as here),
aggregation requirements, vector search, the refusals of `Query::canonicalize`, override
inheritance along map paths, and the order in which production lists merge members (the
comparison already accepts that divergence, decision S4).

## Layout

- `IndexMerge/Model.lean`: the Rust functions, one definition each, with field paths as numbers
  (`NAME` is `__name__`).
- `IndexMerge/Spec.lean`: `MergeSpec`, the declarative condition (at least two wanted fields, no
  order on an equality field, every wanted field covered by some `Member`), the broader
  `BroadSpec`, and the invariant `WF` that every requirement built from a query satisfies.
- `IndexMerge/Lemmas.lean`, `IndexMerge/Theorems.lean`: `merged_sound`, `merged_iff_spec`,
  `merged_none_iff`, `merged_refuses_few`, `merged_refuses_eq_ordered`, `merged_mono`,
  `decide_mono`, `automatic_mono`, `merged_perm`, `decide_served_perm`, `reqOf_wf`,
  `not_exempt_of_hasMode` and the greedy-cover lemmas.
- `IndexMerge/Counterexamples.lean`: `spec_implies_broad` and the counterexamples
  `broad_composite_with_array_field`, `broad_opposite_direction_automatic`,
  `broad_contains_with_descending_name`, `broad_not_complete`, `members_depend_on_order`,
  `one_member_merge`.
- `IndexMerge/Production.lean`: 77 recorded production verdicts (59 rows of
  `conformance/fs-query-index-production.json`, 18 expectations of
  `tools/sdk-smoke/index-merge-oracle.mjs`); a `#guard` fails the build if the model contradicts
  any of them, including the member sets of the 16 plan rows.
- `IndexMerge/Corpus.lean`, `Main.lean`: configurations, names, the corpus format and the
  generator (production rows, the coverage ledger's pairwise rows, a product of query shapes with
  six configurations, and 3000 deterministic random cases).
- `IndexMerge/Axioms.lean`: a build-time guard that the theorems depend only on Lean's standard
  axioms (no `sorry`).

## What the proofs say

The algorithm collects candidates (each composite's maximal ordered equality prefix, when the
composite serves those fields with the query's order; then the enabled automatic indexes when
nothing but `__name__` is ordered), sorts them by size and takes them greedily. `merged_iff_spec`
proves that this merges exactly when `MergeSpec` holds: the maximal prefix is the only prefix a
serving composite can have (an order never names an equality field), and the greedy loop covers
the union of all candidates whatever their order. The members it returns are members in the
sense of the specification (`merged_sound`), and more indexes never refuse a served query
(`decide_mono`).

## Findings

None of these has a recorded production verdict; each is pinned by a Rust test.

1. A composite that carries the array field, such as `(a ASC, tags CONTAINS)`, never joins a
   merge, although it serves `a == x AND tags array-contains y` on its own
   (`broad_composite_with_array_field`).
2. The single-index rule serves `a == x ORDER BY __name__ DESC` from `a`'s ascending automatic
   index, but a merge takes an automatic index only in the requested `__name__` direction
   (`broad_opposite_direction_automatic`).
3. The single-index rule serves `tags array-contains x ORDER BY __name__ DESC` from the contains
   index, but a merge takes it only for an ascending `__name__`
   (`broad_contains_with_descending_name`).
4. The members chosen depend on the order composites were added in; whether a query is served
   does not (`members_depend_on_order`, `decide_served_perm`).
5. A composite that repeats a field, such as `(a, a, b)`, makes a merge of one member that serves
   no duplicate-free set of the equalities on its own (`one_member_merge`); with a single
   equality, `(a, a)` is refused instead (`repeated_single_equality_refused`). `IndexSet` accepts
   such composites; whether production does is not recorded.

## Commands

The toolchain is pinned in `lean-toolchain`; `elan` downloads it on first use.

```sh
lake build                 # checks every proof and the production rows, builds the generator
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-index-merge.corpus
```

The Rust side is `crates/fireemu-core-firestore/tests/index_merge_lean_corpus.rs`: it replays
every case through `decide`, checks the production verdicts, and states the proved properties as
proptest properties over random index sets. Regenerate the corpus after changing `Main.lean` or
the model, and commit both.
