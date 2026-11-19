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

The planner is a base decision with overrides on top: the head answer is the base answer except
where one of three recorded rules fires.

- `IndexMerge/Model.lean`: the base planner, the decision at 4fcd8a7a3 before the index-merge
  observation's rules (`decideBase`): the Rust functions, one definition each, with field paths
  as numbers (`NAME` is `__name__`). Its merge is one attempt that covers fields by path.
- `IndexMerge/Head.lean`: the head planner (`decideHead`): the gate (`gate`: production's rules,
  Standard, collection scope, and a query that is a plain conjunction of equalities and at most
  one array-contains on distinct fields other than `__name__`), the overrides (c)
  (`refusesSingleEquality`), (a) and (b) (`recordedMerge`), and `guardOf`, which says which one
  fires.
- `IndexMerge/Spec.lean`: for the base, `MergeSpec`, the declarative condition (at least two
  wanted fields, no order on an equality field, every wanted field covered by some `Member`), the
  broader `BroadSpec`, and the invariant `WF` that every requirement built from a query
  satisfies.
- `IndexMerge/Lemmas.lean`, `IndexMerge/Theorems.lean`: for the base, `merged_sound`,
  `merged_iff_spec`, `merged_none_iff`, `merged_refuses_few`, `merged_refuses_eq_ordered`,
  `merged_mono`, `decide_mono`, `automatic_mono`, `merged_perm`, `decide_served_perm`,
  `reqOf_wf`, `not_exempt_of_hasMode` and the greedy-cover lemmas.
- `IndexMerge/HeadTheorems.lean`: `head_eq_base_outside_guards`, `head_eq_base_off_gate`,
  `head_eq_base_emulator`, `head_eq_base_enterprise`, `head_eq_base_group`, `head_override`,
  `first_attempt_kept`, `base_merge_kept`, `recorded_kinds` and `head_merge_kinds`.
- `IndexMerge/Counterexamples.lean`: for the base, `spec_implies_broad` and the counterexamples
  `broad_composite_with_array_field`, `broad_opposite_direction_automatic`,
  `broad_contains_with_descending_name`, `broad_not_complete`, `members_depend_on_order`,
  `one_member_merge`, `repeated_single_equality_refused`; for the head, the recorded shapes
  `head_f1`, `head_f3`, `head_f2_refused`, `head_single_equality_refused`, and their
  unrecorded neighbours `head_single_equality_neighbours_served`, `head_f1_descending_refused`,
  `head_group_refused`, `head_contains_any_refused`, `head_enterprise_base`,
  `first_attempt_conflation` and `carried_array_field_with_equality_refused`.
- `IndexMerge/Production.lean`: 101 recorded production verdicts (59 rows of
  `conformance/fs-query-index-production.json`, 18 expectations of
  `tools/sdk-smoke/index-merge-oracle.mjs`, 24 rows of
  `conformance/fs-query-index-merge-production.json`: 21 queries and 3 plans); a `#guard` fails
  the build if the head decision contradicts any of them, including the member sets of the 18
  served plan rows, and a second pins the five rows the base decision alone contradicts (the
  shapes (a), (b) and (c) and the two served plans).
- `IndexMerge/Corpus.lean`, `Main.lean`: configurations, names, the corpus format and the
  generator (production rows, the coverage ledger's pairwise rows, a product of query shapes with
  six configurations, the guard shapes and their neighbours, and 3000 deterministic random
  cases). Every case states the head answer (`expect`), the base answer (`base`) and the
  override that fires (`guard none|a|b|c`).
- `IndexMerge/Axioms.lean`: a build-time guard that the theorems depend only on Lean's standard
  axioms (no `sorry`).

## What the proofs say

The base algorithm collects candidates (each composite's maximal ordered equality prefix, when
the composite serves those fields with the query's order; then the enabled automatic indexes
when nothing but `__name__` is ordered, the array field's contains index only for an ascending
`__name__`), sorts them by size and takes them greedily, covering fields by path.
`merged_iff_spec` proves that this merges exactly when `MergeSpec` holds: the maximal prefix is
the only prefix a serving composite can have (an order never names an equality field), and the
greedy loop covers the union of all candidates whatever their order. The members it returns are
members in the sense of the specification (`merged_sound`), and more indexes never refuse a
served query (`decide_mono`).

The head answer is the base answer whenever no override fires (`head_eq_base_outside_guards`),
in particular for the emulator policy, on Enterprise and at collection-group scope, and whenever
the base merge serves (`first_attempt_kept`). Overrides (a) and (b) only turn a refusal into a
merge, and that merge covers every equality by a member with the field in an ordered mode and
the array filter by a member with the field in contains mode (`recorded_kinds`,
`head_merge_kinds`); override (c) only turns the base's `(a ASC, __name__ DESC)` into a refusal.

## Findings

The index-merge observation (`conformance/fs-query-index-merge-production.json`, recorded
2026-11-19) settled the three shapes the base refuses or serves against production; the head
overrides exactly those:

1. (b), F1: a composite that carries the array field after its equality prefix, such as
   `(a ASC, tags CONTAINS)`, is merged with the remaining equality fields' ascending indexes;
   production's plan is `(a ASC, tags ARRAY_CONTAINS, __name__ ASC)`, `(b ASC, __name__ ASC)`
   (`head_f1`). The base never takes such a composite (`broad_composite_with_array_field`).
2. (c): with only `a`'s ascending index enabled, production refuses `a == x ORDER BY __name__
   DESC`; the base serves it from `(a ASC, __name__ DESC)` (`broad_opposite_direction_automatic`
   is about the base), the head refuses it (`head_single_equality_refused`). Its unrecorded
   neighbours keep the base answer: a serving composite, an order naming the equality field,
   Enterprise and collection-group scope (`head_single_equality_neighbours_served`), and `IS
   NULL` or a filter on `__name__` (corpus cases `shape/isnull-*`, `shape/name-eq-and-eq/*`).
3. (a), F3: for a plain array-contains ordered by `__name__` descending the contains index is
   merged with the equality fields' descending indexes, listed first; production's plan is
   `(tags ARRAY_CONTAINS, __name__ DESC)`, `(a DESC, __name__ DESC)` (`head_f3`). The base takes
   the contains index only for an ascending `__name__` (`broad_contains_with_descending_name`).

The rest have no recorded production verdict:

4. Outside the gate nothing changes: collection-group scope, array-contains-any, Enterprise and
   F1 ordered by `__name__` descending keep the base refusal (`head_group_refused`,
   `head_contains_any_refused`, `head_enterprise_base`, `head_f1_descending_refused`).
5. The base covers by path, and the head keeps that on purpose: `a == x AND tags == [z] AND tags
   array-contains z` ordered by `__name__` ascending, with only `a`'s ascending and `tags`'
   contains index, is merged from `(a ASC, __name__ ASC)` and `(tags CONTAINS, __name__ ASC)`,
   whose contains index also counts for the equality on `tags` (`first_attempt_conflation`).
   The shared path fails the gate's shape, so no override applies.
6. The base's completeness against the single-index rule fails (`broad_not_complete`); the
   members chosen depend on the order composites were added in, whether a query is served does
   not (`members_depend_on_order`, `decide_served_perm`); a composite that repeats a field, such
   as `(a, a, b)`, makes a merge of one member (`one_member_merge`,
   `repeated_single_equality_refused`).

## Commands

The toolchain is pinned in `lean-toolchain`; `elan` downloads it on first use.

```sh
lake build                 # checks every proof and the production rows, builds the generator
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-index-merge.corpus
```

The Rust side is `crates/fireemu-core-firestore/tests/index_merge_lean_corpus.rs`: it replays
every case through `decide` against the head answer (and against the base answer where the guard
is `none`), checks the production verdicts, and states the proved properties as
proptest properties over random index sets. Regenerate the corpus after changing `Main.lean` or
the model, and commit both.
