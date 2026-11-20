# Firestore dispatch index

The model filters a manifest by exact database, then applies the event and path predicate in original manifest order. It proves that querying a single database bucket produces the same ordered observations as scanning the manifest. A runtime can prepare that bucket while retaining the ordinary scan for small manifests.

The corpus crosses manifest size around the scan cutoff, source order, database hit and miss, actual event including Written, and document shape. The Rust replayer exercises the immutable manifest view and its real path parser, comparing exact function names and Unicode capture text in order. The model uses four representative path forms. It does not model the runtime's asynchronous dispatch or reload protocol.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-functions/tests/fixtures/lean-functions-firestore-index.corpus
```

From the workspace root:

```sh
cargo nextest run -p fireemu-core-functions --test functions_firestore_index_lean_corpus
```
