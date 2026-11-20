# Firestore text retrieval and ranking

The reference filters documents by positive occurrences of one token, selects retrieval depth in creation-descending, path-ascending order and then optionally ranks by occurrences. Relevance ties use the retrieval order. Offset and limit apply after ranking. The corpus uses a single token so that occurrence counts determine the order without modeling the floating-point score. More general query membership is modeled separately in [firestore-text-query](../firestore-text-query/README.md).

The guarded theorems establish that any required term can be a candidate source for conjunctive matching, that concatenation remains an independent candidate source, that depth bounds retrieval, and that ranking changes neither retrieval membership nor cardinality. The Rust replay uses the actual public search API with sparse, dense, tied and empty match sets. Unrelated documents exercise the posting-list path. Multi-token scoring, analyzer semantics and index construction are outside this reference.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-search-ranking.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_search_ranking_lean_corpus
```
