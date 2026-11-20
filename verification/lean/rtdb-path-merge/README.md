# Realtime Database atomic path updates in Lean 4

The model specifies a fragment of the multipath update performed by `Tree::update`. It normalizes slashes, rejects duplicate and ancestor paths, and expands each write from the same initial tree before committing. The tree model contains integer leaves and branches. It specifies pruning, replacing a scalar with a child branch, retaining unrelated siblings, and the absence of partial writes after rejection. Dedicated priority updates, numeric overflow, byte limits, and unusual key placements are outside this fragment.

Lean proves that overlap is symmetric and reflexive, a refused transaction keeps the initial tree, and a prepared increment uses the captured value. The 216-row corpus crosses branch, scalar and absent initial values with sibling, aliased, overlapping, malformed and read-only paths. It applies sets, deletions, increments and a malformed server value. The replay checks the precise error kind and the complete exported tree after each update.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-database/tests/fixtures/lean-rtdb-path-merge.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-database --test rtdb_path_merge_lean_corpus`.
