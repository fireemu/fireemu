# Firestore query DNF

This Lean reference interprets an already-built Firestore filter tree as an ordered list of conjunctions. A disjunction concatenates branch lists. A conjunction takes their left-major Cartesian product and concatenates the atoms in each resulting term. An absent filter and an empty conjunction each yield one empty term. An empty disjunction or an empty array of alternatives yields no terms. Duplicate terms and operands are retained.

IN contributes one equality per array item. ARRAY_CONTAINS_ANY contributes the same operator with a singleton array. A non-array operand on either operator remains a single opaque atom at the core boundary. Ordinary leaves remain unchanged. The model reads only the outer choice array and treats each complete operand as opaque. The Rust corpus uses integers, null, and arrays including nested arrays. Canonicalization and wire validation are separate from this reference.

The proofs establish the ordered associativity of the product, its branch count and its total atom occurrences. A separate symbolic evaluator uses these sum/product formulas and is proved equivalent to materialized DNF. Addition and multiplication can be clipped at every expression node without changing the final clipped count, including when an oversized product is eventually multiplied by zero.

The component projection counts all atom occurrences across all DNF branches, all explicit orders, and one component for any parent. The filter portion becomes `u64::MAX / 4` above 4,096 disjunctions. The replay checks the exact ordered vectors and component breakdown through `Query::dnf`, `dnf_disjunction_count`, and `component_count`. Rows that exceed the threshold test only symbolic APIs. The zero-after-saturation row calls only the symbolic count because its raw filter contains an oversized intermediate even though its final count is zero.

## Reproduce

From this directory with the pinned Lean toolchain:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-query-dnf.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_query_dnf_lean_corpus
```
