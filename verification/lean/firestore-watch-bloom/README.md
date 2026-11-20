# Firestore Listen existence-filter bitmap

This reference specifies the existence-filter bitmap on the recorded one-, two-, and three-document shapes and the bit arithmetic of Fireemu's bitmap builder. It models wrapping double hashing from the two halves of a supplied MD5 digest, bit-capacity reduction by padding, and low-bit-first bytes.

The Lean theorems bound each position, preserve bitmap width, and prove that appending an insertion cannot clear an existing bit. The byte corpus supplies independent MD5 digests for UTF-8 names and checks the Rust builder's protobuf bitmap, padding, and hash count. The digest algorithm and Listen lifecycle remain at the existing SDK-vector and stream tests.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-grpc/tests/fixtures/lean-firestore-watch-bloom.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-adapter-grpc -E 'test(=bloom::tests::the_bloom_builder_matches_lean)' --profile pr`.
