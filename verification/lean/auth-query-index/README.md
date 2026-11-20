# Exact Auth account predicates

This model covers union selection by exact account email, phone, and local ID. It distinguishes a complete ownership index from a stale index after unrestricted record access. A namespace can select all owners of an imported duplicate key. Its current record fields remain authoritative after a mutation. The existing [account pagination model](../auth-user-pagination/README.md) covers bounded selection over the available sort fields.

The refinement theorem has a pointwise completeness assumption for the index. The proof preserves the sequence of selected records, including map-key order, so paging, count, and result reordering observe the same input. Other theorems cover unrestricted fallback, empty and duplicate predicates, and selected Unicode witnesses. The email function models the finite fixture vocabulary rather than the Unicode case database. The cases include lowercase expansion, Kelvin sign folding, and contextual Greek final sigma.

The corpus exercises trusted artifact imports, exact phone selection across duplicate owners, changes through tracked setters, direct replacement of mutable selector fields, cloning, reset, namespace isolation, and bounded pages. The Rust replayer uses the public `AuthStore` methods and verifies every output ID and the unpaginated count.

```sh
lake build
lake exe corpus | cmp - ../../../crates/fireemu-core-auth/tests/fixtures/lean-auth-query-index.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-auth --test auth_query_index_lean_corpus
```
