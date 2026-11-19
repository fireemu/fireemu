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
- `IndexMerge/Spec.lean`: `MergeSpec`, the declarative condition (at least two wanted filters,
  no order on an equality field, every wanted filter covered by some `Member` of the phase that
  applies, by kind: an equality by an ordered field, the array filter by a contains field), the
  broader
  `BroadSpec`, and the invariant `WF` that every requirement built from a query satisfies.
- `IndexMerge/Lemmas.lean`, `IndexMerge/Theorems.lean`: `phase_sound`, `phase_iff`,
  `member_recorded`, `merged_sound`, `merged_iff_spec`, `merged_kinds`, `merged_none_iff`, `merged_refuses_few`, `merged_refuses_eq_ordered`, `merged_mono`,
  `decide_mono`, `automatic_mono`, `merged_perm`, `decide_served_perm`, `reqOf_wf`,
  `not_exempt_of_hasMode` and the greedy-cover lemmas.
- `IndexMerge/Counterexamples.lean`: `spec_implies_broad`, the recorded shapes
  `merge_composite_with_array_field` (F1), `opposite_direction_automatic_refused` (F2) and
  `merge_contains_with_descending_name` (F3), the unrecorded refusal
  `composite_with_array_field_descending_name_refused`, the unrecorded boundaries
  `composite_with_array_field_group_refused`, `contains_descending_name_group_refused`,
  `contains_any_descending_name_refused` and `single_equality_neighbours_served`, the kind
  refusals `array_member_never_covers_equality` and `carried_array_field_never_covers_equality`,
  the counterexample
  `broad_mirror_direction_automatic` with `broad_not_complete`, `members_depend_on_order`,
  `one_member_merge` and `repeated_single_equality_refused`.
- `IndexMerge/Production.lean`: 101 recorded production verdicts (59 rows of
  `conformance/fs-query-index-production.json`, 18 expectations of
  `tools/sdk-smoke/index-merge-oracle.mjs`, 24 rows of
  `conformance/fs-query-index-merge-production.json`: 21 queries and 3 plans); a `#guard` fails
  the build if the model contradicts any of them, including the member sets of the 18 served
  plan rows.
- `IndexMerge/Corpus.lean`, `Main.lean`: configurations, names, the corpus format and the
  generator (production rows, the coverage ledger's pairwise rows, a product of query shapes with
  six configurations, and 3000 deterministic random cases).
- `IndexMerge/Axioms.lean`: a build-time guard that the theorems depend only on Lean's standard
  axioms (no `sorry`).

## What the proofs say

The algorithm makes up to two attempts: first with the rules as before the index-merge
observation, then, at collection scope only, with the rules production was recorded adding.
Each attempt collects candidates (each composite's maximal ordered equality prefix, when the
composite serves those fields with the query's order, followed in the recorded attempt by the
array field when the composite carries it right after the prefix and nothing but `__name__` is
ordered, ascending; then, when nothing but `__name__` is ordered, the enabled automatic indexes
of the equality fields and the array field's contains index in the requested `__name__`
direction: ascending after the equality members, and in the recorded attempt for a plain
array-contains also descending, before them), sorts the composites by size and takes the
candidates greedily. What is covered is a filter by kind: an equality on a field, or the array
filter. `merged_iff_spec` proves that this merges exactly when `MergeSpec` holds: the maximal prefix is the only prefix a
serving composite can have (an order never names an equality field), and the greedy loop covers
the union of all candidates whatever their order, and the recorded attempt has every member of
the other (`member_recorded`). The members it returns are members in the sense of the
specification (`merged_sound`), they cover equalities by ordered fields and the array filter by
a contains field (`merged_kinds`), and more indexes never refuse a served query
(`decide_mono`, `automatic_mono`, including production's rule that an equality ordered by
`__name__` descending needs the field's descending index; that rule applies to one equality,
with no order on it, on Standard at collection scope).

## Findings

The index-merge observation (`conformance/fs-query-index-merge-production.json`, recorded
2026-11-19) settled the three shapes that were counterexamples to completeness against the
single-index rule; the model now follows production on each:

1. F1: a composite that carries the array field after its equality prefix, such as
   `(a ASC, tags CONTAINS)`, joins a merge as the member for `a` and `tags`; production's plan is
   `(a ASC, tags ARRAY_CONTAINS, __name__ ASC)`, `(b ASC, __name__ ASC)`
   (`merge_composite_with_array_field`). The model carries the array field only in that shape
   (nothing but `__name__` ordered, ascending); with `__name__` descending or another ordered
   field there is no recorded verdict and the composite is a candidate only for its equality
   prefix, so the same index set refuses F1 ordered by `__name__` descending
   (`composite_with_array_field_descending_name_refused`, unrecorded).
2. F2: with only `a`'s ascending index enabled, production refuses `a == x ORDER BY __name__
   DESC` and `a == x AND b == y ORDER BY __name__ DESC`; under production's rules the
   single-index rule refuses the first too, so the second is no longer a counterexample
   (`opposite_direction_automatic_refused`). The refusal applies to one equality with no order
   on it, on Standard at collection scope; the emulator policy, Enterprise and collection-group
   scope keep serving the first from the ascending index (`single_equality_neighbours_served`,
   unrecorded).
3. F3: for a plain array-contains the contains index joins a merge for a descending `__name__`
   too, listed before the equality members; production's plan is
   `(tags ARRAY_CONTAINS, __name__ DESC)`, `(a DESC, __name__ DESC)`
   (`merge_contains_with_descending_name`).

The rules F1 and F3 added apply only where the merge was refused without them and only at
collection scope, so every answer given before keeps its members and their order. Their
boundaries have no recorded verdict: collection-group scope refuses both shapes
(`composite_with_array_field_group_refused`, `contains_descending_name_group_refused`), and
array-contains-any refuses F3 (`contains_any_descending_name_refused`).

Coverage is by filter kind: a contains member covers the array filter only, never an equality
on the same path, so `tags == [z] AND tags array-contains z` needs an ordered member for `tags`
(`array_member_never_covers_equality`, `carried_array_field_never_covers_equality`,
`merged_kinds`). The model used to let the contains member cover both.

Open findings, without a recorded production verdict, each pinned by a Rust test:

4. The mirror of F2: with only `a`'s descending index enabled, the single-index rule serves
   `a == x ORDER BY __name__ ASC` from `(a DESC, __name__ ASC)`, but a merge takes an automatic
   index only in the requested `__name__` direction, so `a == x AND b == y ORDER BY __name__ ASC`
   is refused (`broad_mirror_direction_automatic`, `broad_not_complete`).
5. The members chosen depend on the order composites were added in; whether a query is served
   does not (`members_depend_on_order`, `decide_served_perm`).
6. A composite that repeats a field, such as `(a, a, b)`, makes a merge of one member that serves
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
