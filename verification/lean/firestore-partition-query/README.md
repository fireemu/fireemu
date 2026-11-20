# Firestore partition sampling

The reference covers Fireemu's public partition sampler. FNV-1a hashes the salt followed by the UTF-8 bytes of the relative document path. A key is eligible when its hash with the sample salt is a multiple of 141. The priority salt orders eligible candidates, with a document-key tie-break. A request takes a prefix of that order and re-sorts the selected documents by key.

The proofs show that the hash depends on the relative path rather than namespace, that the number of cursors is the lesser of the request and available sample count, and that the returned membership is nested as the requested count grows. Every returned key is an eligible input. The Rust test checks exact sampled keys and exact ordered cursor lists, with Unicode, nested paths, reverse input, and deliberate same-relative and duplicate-path ties.

This contract specifies Fireemu's selected positions. Production's internal hash and page-token semantics are outside the reference.

## Reproduce

From this directory with the pinned toolchain:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-grpc/tests/fixtures/lean-firestore-partition-query.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-adapter-grpc --test firestore_partition_query_lean_corpus
```
