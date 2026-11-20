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
general aggregation requirements, vector search, the refusals of `Query::canonicalize`, and override inheritance along map paths. Observation 2a checks exact member order for seven recorded plans. Divergence S4 still applies to other recorded orders, as documented below.

## Layout

The planner is a base decision with overrides on top: the head answer is the base answer except
where one of three recorded rules fires.

- `IndexMerge/Model.lean`: the base planner, the decision at 4fcd8a7a3 before the index-merge
  observation's rules (`decideBase`): the Rust functions, one definition each, with field paths
  as numbers (`NAME` is `__name__`). Its merge is one attempt that covers fields by path.
- `IndexMerge/Head.lean` defines `decideHead`, the production-policy gate for Standard, the independent guards for equality refusal (c) and the recorded merges (a) and (b), and `guardOf`.
- `IndexMerge/Spec.lean`: for the base, `MergeSpec`, the declarative condition (at least two
  wanted fields, no order on an equality field, every wanted field covered by some `Member`), the
  broader `BroadSpec`, and the invariant `WF` that every requirement built from a query
  satisfies.
- `IndexMerge/Lemmas.lean`, `IndexMerge/Theorems.lean`: for the base, `merged_sound`,
  `merged_iff_spec`, `merged_none_iff`, `merged_refuses_few`, `merged_refuses_eq_ordered`,
  `merged_mono`, `decide_mono`, `automatic_mono`, `merged_perm`, `decide_served_perm`,
  `reqOf_wf`, `not_exempt_of_hasMode` and the greedy-cover lemmas.
- `IndexMerge/HeadTheorems.lean`: `head_eq_base_outside_guards`, `head_eq_base_off_gate`,
  `head_eq_base_emulator`, `head_eq_base_enterprise`, `head_eq_base_group_outside_refusal`, `head_override`, `recorded_refusal_iff_not_automatic_equality_serves`, `first_attempt_kept`, `base_merge_kept`, `recorded_kinds` and `head_merge_kinds`.
- `IndexMerge/Counterexamples.lean`: for the base, `spec_implies_broad` and the counterexamples
  `broad_composite_with_array_field`, `broad_opposite_direction_automatic`,
  `broad_contains_with_descending_name`, `broad_not_complete`, `members_depend_on_order`,
  `one_member_merge`, `repeated_single_equality_refused`; for the head, the recorded shapes
  `head_f1`, `head_f3`, `head_f2_refused`, `head_single_equality_refused`, and their
  neighbours `head_single_equality_neighbours`, `head_f1_descending_refused`,
  `head_group_merges_a_and_refuses_b`, `head_contains_any_merges`, `head_enterprise_base`,
  `head_two_carriers_base`, `head_group_carrier_base`, `head_b_with_automatic_contains`,
  `head_b_descending_carrier_base`, `head_b_explicit_name_carrier`,
  `first_attempt_conflation` and `carried_array_field_with_equality_refused`.
- `IndexMerge/Production.lean`: 101 recorded production verdicts (59 rows of
  `conformance/fs-query-index-production.json`, 18 expectations of
  `tools/sdk-smoke/index-merge-oracle.mjs`, 24 rows of
  `conformance/fs-query-index-merge-production.json`: 21 queries and 3 plans); a `#guard` fails
  the build if the head decision contradicts any of them, including the member sets of the 18
  served plan rows, and a second pins the five rows the base decision alone contradicts (the
  shapes (a), (b) and (c) and the two served plans). Separate guards check the 13 observation 2a equality-refusal and control rows and 17 merge and control rows. The latter compare the recorded plan order directly.
- `IndexMerge/Corpus.lean`, `Main.lean`: configurations, names, the corpus format and the
  generator (production rows, the coverage ledger's pairwise rows, a product of query shapes with
  six configurations, the guard shapes and their neighbours, and 3000 deterministic random
  cases). Every case states the head answer (`expect`), the base answer (`base`) and the
  override that fires (`guard none|a|b|c|reverse|shared|carrier`).
- `IndexMerge/Axioms.lean`: a build-time guard that the theorems depend only on Lean's standard
  axioms (no `sorry`).

## What the proofs say

The Lean base `Query` is a flat conjunction with explicit order clauses. It omits literal values, general DNF expansion, aggregation requirements, nearest-neighbour stages and wire canonicalization. For observation 2a, `QuerySource` distinguishes an ordinary equality, the projected equality arms of one-element IN or same-field two-branch OR, and an equality with an unlimited count. The corpus replayer rebuilds those source queries through the public API. The Rust `stage_b_layer_tests` proptest also checks canonical query shapes, including repeated predicates and unsupported forms.

The base algorithm collects candidates (each composite's maximal ordered equality prefix, when
the composite serves those fields with the query's order; then the enabled automatic indexes
when nothing but `__name__` is ordered, the array field's contains index only for an ascending
`__name__`), sorts them by size and takes them greedily, covering fields by path.
`merged_iff_spec` proves that this merges exactly when `MergeSpec` holds: the maximal prefix is
the only prefix a serving composite can have (an order never names an equality field), and the
greedy loop covers the union of all candidates whatever their order. The members it returns are
members in the sense of the specification (`merged_sound`), and more indexes never refuse a
served query (`decide_mono`).

The head and base agree whenever no override fires (`head_eq_base_outside_guards`). The proof quantifies over the query, index catalog, policy, edition and equality source. The recorded merges apply to collection queries with a plain conjunction. They can replace a refusal with a merge whose members cover the equality and array filter kinds (`recorded_kinds`, `head_merge_kinds`). Refusal (c), the unserved merge guards and the already-served plan replacements each have their own shape conditions. The proofs preserve any base merge outside the plan replacements; the new plans identify their exact automatic source plans.

## Findings

The index-merge observation (`conformance/fs-query-index-merge-production.json`, recorded
2026-11-19) settled the three shapes the base refuses or serves against production; the head
overrides exactly those:

1. (b), F1. The unique collection composite that carries the array field after an ascending equality prefix, such as `(a ASC, tags CONTAINS)`, joins the remaining ascending equality members. The carrier must serve its prefix and the array filter on its own. An enabled automatic contains index no longer disables the carrier. For the implicit-order automatic plan, the absence of any related carrier permits the recorded reversal. One related carrier permits the recorded replacement only when it qualifies. An off-axis carrier or multiple related carriers keep the exact base plan and order (`unqualified_carrier_keeps_implicit_plan`, `multiple_related_carriers_keep_implicit_plan`). A unique qualifying carrier can still remove a refusal when another related carrier falls outside the recorded scope, prefix or suffix.
2. (c) began with the observation that only `a`'s ascending mode was enabled for `a == x ORDER BY __name__ DESC`. The base reported `(a ASC, __name__ DESC)` as serving and production refused. The rule now includes the observation 2a shapes in the table below. A serving composite and Enterprise preserve the base result (`head_single_equality_neighbours`).
3. (a), F3. The contains index precedes the automatic descending equality members. Observation 2a records a plain group query and a collection query with singleton array-contains-any. Group scope uses group modes for every member.
4. Enterprise, unrecorded membership forms and descending-name queries without all the applicable modes keep their baseline result.
5. The base covers by path. The recorded shared-path override adds a separate contains member when the exact baseline contains the two ordered members and the contains mode exists. Sparse configurations retain the base path coverage (`first_attempt_conflation`). A query with only the shared field keeps the base single-index result.
6. The base's completeness against the single-index rule fails (`broad_not_complete`); the
   members chosen depend on the order composites were added in, whether a query is served does
   not (`members_depend_on_order`, `decide_served_perm`); a composite that repeats a field, such
   as `(a, a, b)`, makes a merge of one member (`one_member_merge`,
   `repeated_single_equality_refused`).

## Observation 2a equality refusals

For an equality-only requirement on the recorded axes, an automatic ordered mode can serve only if its direction agrees with the effective `__name__` direction (`AutomaticEqualityServes`). The proof `recorded_refusal_iff_not_automatic_equality_serves` connects the implementation guard to the declarative rule when the base chose an automatic scan and no composite serves. The collection-scope descending cases also apply at group scope under ruling 3. The recording directly exercised the plain group equality. Only that plain group equality applies to the ascending mirror. The collection-scope mirror, other operators and other aggregation shapes stay at the base decision.

| Row | Canonical query shape and effective name direction | Available automatic mode in scope | Production verdict |
| --- | --- | --- | --- |
| 12 | Collection, count of `a == 1`, name DESC | ASC | Refused |
| 13 | Collection, count of `a == 1`, implicit name ASC | ASC | Served |
| 14 | Collection, `a IN [1]`, name DESC | ASC | Refused |
| 15 | Collection, `a == 1 OR a == 0`, name DESC | ASC | Refused |
| 16 | Collection, `a == 1 ORDER BY a DESC`, implicit name DESC | ASC | Refused |
| 17 | Collection, `a == 1 ORDER BY a ASC, __name__ DESC` | ASC | Refused |
| 18 | Collection, `a IS NULL`, name DESC | ASC | Refused |
| 37 | Group, `a == 1`, name ASC | ASC | Served |
| 38 | Group, `a == 1`, name DESC | ASC | Refused |
| 39 | Group, Explain plan for row 38 | ASC | Refused |
| 47 | Group, `a == 1`, name ASC | DESC | Refused |
| 48 | Group, `a == 1`, name DESC | DESC | Served |
| 49 | Group, Explain plan for row 47 | DESC | Refused |

Rows refer to `conformance/fs-query-index-merge2-production.json`. The Rust PICT replay crosses these cases with nearby query forms, context, mode availability and serving composites.

## Observation 2a merge and plan rows

| Rows | Shape | Result |
| --- | --- | --- |
| 1 | Two equalities with explicit ascending name | Reverse the two automatic equality members |
| 2 | Two equalities and contains with implicit name | Contains first, then the reversed automatic equality members |
| 3 | One equality and contains with explicit ascending name | Contains first, then the automatic equality member |
| 5 | One equality and singleton array-contains-any with descending name | Collection automatic merge (a) |
| 8, 9 | One equality and a shared array equality and contains with explicit name order | Contains, ordinary ordered member, then shared ordered member |
| 20, 22–24 | Two equalities with contains or singleton array-contains-any, or a count, with descending name and the exempt catalog | Refused |
| 21, 25 | Two equalities and an unlimited count of plain contains, or singleton array-contains-any, with no order | Collection carrier merge (b) |
| 31 | Two equalities and contains with descending name and built-in modes | Served |
| 32 | Two equalities and plain contains with no order, built-in modes and one serving carrier | Carrier first, then the remaining ascending automatic equality member |
| 44 | Group equality and contains with ascending name, only group DESC and group CONTAINS available | Refused |
| 45, 46 | Group equality and contains with descending name, group DESC and group CONTAINS available | Group automatic merge (a) |

Rows 1–3 and 8–9 settle the matching automatic plan-order and shared-path portions of S4. Row 46 also pins the group merge order. Row 32 establishes a different member set once the unique carrier is present. S4 remains in force for the other shapes. Unobserved plans keep their member order, and the base proof and corpus still describe the algorithm at 4fcd8a7a3.

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
