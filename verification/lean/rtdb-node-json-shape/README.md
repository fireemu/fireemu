# Realtime Database node JSON shape in Lean 4

This reference covers the core tree's plain and export formats. A plain branch renders as an array when every retained key is a canonical decimal index and the highest index is less than twice the number of retained children. Missing indices render as null. Export retains map keys and member priorities. Null children disappear, and a non-null priority on absent data is rejected. The corpus also observes precedence among the covered server-value placeholder, invalid priority, malformed value wrapper, and invalid child key shapes.

The guarded theorems cover the strict density threshold, the bound on a successful array length, null-child elimination, and the effect of priorities on plain output. The reference covers integer leaf cases and selected priority forms, including when an integer priority member is stored as a double. Transport JSON text, arbitrary nested source shapes, and path limits have separate coverage.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-database/tests/fixtures/lean-rtdb-node-json-shape.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-database --test rtdb_node_json_shape_lean_corpus`.
