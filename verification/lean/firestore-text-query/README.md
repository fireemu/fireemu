# Firestore lexical-v1 text query membership

This model [matches source tokens](../../../crates/fireemu-core-firestore/src/text_search.rs) without an inverted index. Unquoted plain terms can occur in different fields and can also match their concatenation as one whole token. Phrases require a contiguous sequence in one allowed field. Exclusions, field restrictions and the legacy interpretations of OR, colons and an unmatched leading quote are modeled separately.

Lean proves the singleton rule, the all-negative result and unknown-field precedence. It checks cross-field conjunction versus same-field phrases, exact input-order concatenation and field restriction. It also proves that retrieval depth is applied before offset and that a page cannot exceed its limit.

The generator binds a finite set of raw queries to source-token expectations across three immutable document corpora. The Rust replay uses both public lexical analyzers and the real query parser and search API, including selected directional Latin folding and creation-order ties. Syntax beyond the named queries, general Unicode normalization, relevance scores and index lifecycle are outside this model.

## Commands

```sh
cd verification/lean/firestore-text-query
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-text-query.corpus
cd ../../..
cargo nextest run -p fireemu-core-firestore --test firestore_text_query_lean_corpus
```
