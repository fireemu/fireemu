# Cloud Storage list pages in Lean 4

`StorageListPages/Spec.lean` builds the logical entry stream by projecting a fixed snapshot through name filtering, delimiter folding, ordering, and duplicate collapse. The public Rust paths in `crates/fireemu-core-storage/src/store.rs` scan the ordered storage maps. The reference instead sorts the projected keys before taking a page.

The logical stream distinguishes item names, individual generations, and folded prefixes. It models inclusive JSON API continuations, exclusive Firebase continuations, strict resumption after an unknown key, and the optional item for an object exactly named by a folded prefix. That item shares the prefix's page slot.

Theorems prove that splitting a finite stable stream at a positive page size loses no keys, that the flattened traversal has no duplicates, and that a boundary filter preserves the remaining region when the marker separates it from the emitted region. The fixture replays full traversals, comparing each returned item's name, generation, and archive flag, the folded prefix list and the actual continuation. Its stable-snapshot scope assumes fixed bucket membership, valid names and positive page sizes. Mutation of the live population between requests, adapters' page-token encoding, and the zero page size are separate contracts.

## Commands

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-storage/tests/fixtures/lean-storage-list-pages.corpus
```

From the repository root, run `cargo test -p fireemu-core-storage --test storage_list_pages_lean_corpus`.
