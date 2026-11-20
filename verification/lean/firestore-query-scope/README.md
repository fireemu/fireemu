# Firestore query scope membership

The Lean model specifies `QueryScope::contains` by stripping an exact anchor prefix of (collection, document) pairs. A direct query requires one remaining pair. A descendants query requires at least one. A named query checks the last remaining collection and a kindless query accepts any collection.

The proofs show that stripping an anchor from its append returns the entire suffix, that every successful strip gives an anchor/suffix decomposition, and that the anchor itself is excluded. Matching a direct scope implies matching its descendant counterpart, and matching a named scope implies matching its kindless counterpart. A root kindless descendants scope contains every nonempty document path.

The Rust replay constructs real `QueryScope` and `DocumentPath` values. The corpus crosses four scope kinds with root, shallow, and deep anchors, matching and mismatching paths, and project and database ID changes. Namespace differences deliberately have no effect on this membership predicate. Any project or database isolation is a caller responsibility and outside this model.

## Reproduce

From this directory with the pinned Lean toolchain:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-query-scope.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_query_scope_lean_corpus
```
