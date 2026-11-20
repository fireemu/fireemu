# Firestore single-index selection in Lean 4

A Lean 4 specification of single-index selection in `crates/fireemu-core-firestore/src/index.rs`, machine-checked consistency rules, and a deterministic corpus replayed through the Rust public API. The project uses the same dependency-free toolchain as the other Firestore Lean projects.

## Layout

- `SingleIndex/Spec.lean` defines a bounded scan as fixed ordered keys, an optional array-element key, and varying lexicographic keys ending in the unique document name. The scope and collection are part of the denotation. The document model uses abstract value ranks and separate array elements. The shape contract specifies at most 100 fields, at most one membership key, and the necessity rule for shorter definitions.
- `SingleIndex/Model.lean` mirrors requirement extraction, automatic modes and inheritance, the field predicate, suggestions, definition checks, and planner priority. Field paths are lists of segments. Equality filters and `IS NULL` / `IS NAN` contribute unique non-name equality paths. The last membership filter contributes the array slot. Inequalities enter the effective order with the last explicit direction, in canonical field order, and fixed equality paths leave the varying order. Sum and average add uncovered paths in ascending path order before the name key. Count adds no path. Overrides replace the built-ins at the closest ancestor, with an empty list overriding inheritance.
- `SingleIndex/Theorems.lean` relates the denotation and the model. `SingleIndex/Counterexamples.lean` proves the findings below. `SingleIndex/Axioms.lean` guards every exported theorem's exact axiom list at build time.
- `Main.lean` documents the format and emits 3,727 cases, including 21 offline production verdicts, a product over query shapes and contexts, catalog variations, aggregation requirements, and counterexamples.

## Proofs

| Rule | Theorems |
| --- | --- |
| Exact fixed selection and lexicographic order | `scan_filters_are_exact`, `scan_order_is_exact`, `equality_prefix_iff` |
| Composite completeness and soundness with a clean name layout | `composite_complete`, `composite_explicit_iff`, `composite_implicit_iff` |
| Suggested definition and shape | `required_index_serves`, `required_index_accepted`, `required_index_creatable`, `capacity_and_necessity_iff` |
| Automatic mode selection, exact scope, and agreement for regular single-field requirements | `automatic_single_iff`, `automatic_single_result`, `automatic_regular_iff`, `automatic_regular_result_serves`, `automatic_scope` |
| Equality, membership, and order mode rules | `equality_only_rules`, `membership_only_rules`, `order_only_rules`, `overlapping_kinds`, `membership_with_order_needs_two_keys` |
| Collection composites and reversal | `composite_collection_cannot_serve_group`, `composite_reversed` |
| Planner priority and monotonicity | `base_priority`, `base_indexed_iff`, `automatic_mono`, `base_monotone`, `head_refusal_iff`, `head_after_base_indexed_extension` |

A clean explicit layout has one name after all varying fields. A clean implicit layout has no name in that suffix. When the varying suffix is empty, the implicit-layout equivalence also requires the requested name direction to equal the declared implicit direction. Equivalences use the exact query scope. The completeness result takes the symbolic scan as its hypothesis and needs no extra layout or scope assumption.

The suggested definition sorts equality paths, emits the array key, copies the remaining order, and passes both definition checks whenever the requirement has a final name order and the full field count fits. The planner chooses automatic first, then the first serving composite in list order, then a production-policy merge, then the fallback. Standard Production reports missing. Standard ProductionReport and Emulator assume the suggestion. Enterprise emits a full scan with the suggestion. Both Production and ProductionReport enable the production rules.

The base stays indexed when effective modes and composites grow and any existing merge remains available. The merge contract comes from the sibling `index-merge` project. `head_refusal_iff` describes the recorded equality refusal under the Standard production rules. Observation 2a extends the descending-name case to the recorded one-field equality shapes and the ascending-name mirror of a plain group equality. The model requires the base automatic scan to use the opposite mode and a serving composite to be absent. Its corpus includes ordered equalities, IS NULL, count, both group cases and the collection-scope mirror that stays at base. The `index-merge` model and Rust replay cover the source distinctions for IN and OR.

## Findings

| Input | Proved behavior |
| --- | --- |
| Collection query `ORDER BY a ASC, __name__ DESC`, given a group composite `(a ASC, __name__ DESC)` | `group_composite_serves_collection` proves that the predicate accepts the other scope, violating the exact-scope specification. The recorded `group-scope-composite-for-collection` example confirms this asymmetry for `a == 0 ORDER BY b ASC`. The automatic rule uses exact scope in both directions. |
| `ORDER BY a ASC` with `(__name__ ASC, a ASC)` or `(a ASC, __name__ ASC, __name__ DESC)` | `name_before_order` and `first_name_wins` prove that the predicate takes the first name mode and ignores the positions and remaining name keys. `name_before_order_reorders_documents` gives two documents whose comparison reverses when the name is moved ahead of `a`. The extra trailing name violates the declared layout. |
| `a == 1 ORDER BY __name__ DESC` with `(a ASC)`, or `tags array-contains z ORDER BY __name__ DESC` with `(tags CONTAINS)` | `implicit_name_ignores_fixed_prefix` and `implicit_name_ignores_array_key` prove acceptance even though the declared implicit key is ascending. These one-field raw definitions also fail `check_necessary`. The public predicate and `IndexSet::add_composite` allow them to be exercised independently of catalog admission. |
| `tags == [z] AND tags array-contains z` with its built-in contains mode | `contains_covers_overlapping_equality` proves that automatic selection returns the contains index alone. `contains_scan_can_admit_non_equal_array` gives an array containing the element with a different whole-array value. The composite predicate rejects that same single index and accepts a definition with both keys. |
| `ORDER BY a ASC, __name__ DESC` with ASC enabled | `opposite_order_name_needs_composite` proves that the configured explicit suffix serves even though the automatic ordered rule refuses. For equality alone, either ordered mode serves with the requested explicit name direction, and the automatic base prefers the matching mode before falling back. |
| Emulator query `ORDER BY a ASC, a DESC, __name__ ASC` | `repeated_order_uses_first_direction` proves that the automatic rule takes the first direction and the composite predicate asks for both clauses. Production canonicalization refuses the repeated order before planning. |
| Flip every direction of `ORDER BY __name__ ASC`, or compare `a == 1` with only ASC enabled before and after flipping the requested name | `composite_reversed` proves simultaneous reversal of a composite and requirement preserves the predicate, including implicit and malformed name suffixes. `primary_key_reversal_refused` proves that automatic reversal fails on the primary key. `equality_reversal_depends_on_enabled_modes` shows the ASC-only equality fallback keeps ASC for the fixed key and changes the tie direction. Flipping the enabled mode provides the flipped physical key. |
| `a == 1 ORDER BY __name__ DESC` with only collection ASC enabled and no serving composite | `head_refuses_ascending_only` proves the base returns `(a ASC, __name__ DESC)`, then the Standard Production head reports that same definition missing. The recorded `ascending-only#a-alone-name-desc` verdict agrees with the head. The public test also checks the ProductionReport and Enterprise decisions via the corpus. |
| 100 different equalities and an implicit name key, exercised through the Enterprise planner | `required_index_can_exceed_capacity` proves the suggested 101-field definition serves according to the composite predicate and fails `check_capacity`. The adjacent 99-equality suggestion fits. The recorded Standard component-limit cases concern an earlier query limit. |

The mode proofs distinguish the cases by key kind. With just an equality, CONTAINS and VECTOR fail both rules. With just membership, ASC, DESC, and VECTOR fail both rules. A varying ordered field needs the exact ordered mode, and the automatic rule also needs its name direction to match. Membership plus an order on the same path needs two separate keys. For equality plus membership on the same path, automatic selection counts the contains key for both, while the composite rule requires separate ordered and contains keys. The earlier path-keyed merge can also return an ordered member for the shared path when CONTAINS is disabled. That merge behavior belongs to the existing merge specification.

## Recorded production

The 21 `production/` rows are checked by `#guard` in `Main.lean`. The head agrees with all 21 recorded served/missing verdicts. The base agrees with 20 and differs on the ascending-only equality described above. Comparison uses the planner-relevant configuration and filter kinds. Literal filter values and projections have no effect on these verdicts.

- `conformance/fs-query-index-production.json`, `index-selection/automatic-and-merge`: `name-descending-alone`, `name-descending-with-own-index`, `array-contains-alone`, `single-range-and-order`, `equality-and-name-descending`, and `equality-and-array-contains-merge` agree.
- The same recording, `index-selection/composites`: `range-and-name-order-descending`, `array-contains-and-order`, `array-contains-and-order-missing`, `sum-with-composite`, `sum-missing-composite`, and `count-missing-composite` agree.
- The same recording, `index-selection/scopes-and-exemptions`: `exempted-field-equality`, `collection-scope-composite-for-group`, both `group-scope-composite-for-*` rows, both `group-only-override-*-equality` rows, and `group-array-contains-without-group-index` agree.
- `conformance/fs-query-index-merge-production.json`, `shapes/builtin#contains-alone-name-desc` agrees in both layers. `shapes/ascending-only#a-alone-name-desc` agrees in the head.
- `conformance/fs-config-lifecycle-production.json`, `fs-config/index/lifecycle/composite/steps/single-field`: refusal of a one-field ordinary composite agrees with `check_necessary`.

## Open

- The Rust requirement builders, automatic predicate and base planner are private. Corpus replay observes them through `decide`, `validate_aggregation_query`, `plan_scans` and `missing_requirements`. For stage-B refusal rows, the base index is observed through the same planner on Enterprise, where the gate is off.
- The denotation covers one bounded scan over indexed fields and abstract value ranks. Query validation, missing-value storage semantics, execution-time filtering, range bounds, array disjunction expansion beyond a single arm, and the storage engine are outside this proof. The model consumes the merge stage's answer, and the monotonicity result assumes that an available merge remains available. The corpus supplies merge outcomes explicitly for the merge fall-through cases.

## Commands

Run from this directory with the pinned toolchain.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-single-index.corpus
```

The Rust replay and proptest properties are in `crates/fireemu-core-firestore/tests/single_index_lean_corpus.rs`. They check planner answers, scan plans, missing reports, candidate and suggested definition checks, and the direct composite predicate. The Rust build needs only the checked-in corpus.
