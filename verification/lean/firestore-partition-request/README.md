# Firestore partition query shape

This model describes which canonical query shapes can reach sampling. A kindless all-descendants query returns no splits. Other queries require the collection-group scope and check limits, offsets, strict property masks, then start and end cursors. For an admitted group, only explicit ordering requests a split.

The fixture exercises every combination of these flags through the Rust adapter's `partition::check_query` and compares exact diagnostic text. Protobuf decoding, vector and filter checks, page tokens, and the Firestore database are outside this shape phase. The sampler and its exact cursor selection are described in [the partition selection model](../firestore-partition-query/README.md).

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-grpc/tests/fixtures/lean-firestore-partition-request.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-adapter-grpc --test firestore_partition_request_lean_corpus --profile pr`.
