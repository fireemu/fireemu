# Auth administrator pagination in Lean 4

This package models filtering, sorting, and slicing the administrator user query in `crates/fireemu-core-auth/src/store.rs`. Its reference filters the user list once, sorts the entire match set, and applies the requested offset and limit. Missing optional values sort before present ones in ascending order. Descending reverses the primary field and keeps ascending local IDs for ties. Signed nanoseconds truncate towards zero at millisecond precision.

The proof relates a bounded ordered insertion to a complete insertion sort. Discarding candidates beyond the retained prefix at an intermediate step preserves the final prefix. Retaining the first `offset + limit` elements therefore preserves the requested page. This permits bounded candidate representations on the distinct composite keys produced by the store. It does not establish a time or allocation benchmark.

The Rust replay crosses all five public sort fields, both directions, empty and overlapping filters, missing values, millisecond ties, and windows from empty to `usize::MAX`. Fixtures use ASCII email addresses and synthetic users. The model does not specify wire pagination tokens, Unicode email normalization, namespace selection, or production ordering beyond the store's documented contract.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-auth/tests/fixtures/lean-auth-user-pagination.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-auth --test auth_user_pagination_lean_corpus`. Each row contains the field, direction, filter recipe, offset, limit, match count, and returned local IDs. The replay requires no Lean executable.
