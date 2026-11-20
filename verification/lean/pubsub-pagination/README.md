# Pub/Sub ordered pagination

The reference models `fireemu-core-pubsub::pagination::paginate` for an immutable catalog of unique resources presented in name order. Strict continuation identifies the previous page's last resource and resumes after it. Emulator continuation exposes the next resource name verbatim and resumes at the first lexical name at or beyond the supplied boundary. The model treats opaque strict token bytes as a wire encoding of the boundary. The Rust replay obtains opaque test tokens from an independent two-resource catalog and verifies returned pages and tokens against those boundaries. Issued-token history for deleted names belongs to `PubSubState::paginate`.

The Lean laws prove the split into a page and its remainder, page capacity, the strict and emulator default size distinction, resume behavior at the first matching boundary, and no continuation after exhaustion. The 252 corpus rows cross policy, signed page size, cursor shape and catalog size. They include an over-limit request with an invalid token and the 1,000-resource emulator default boundary.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-pagination.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-core-pubsub -E 'binary(pubsub_pagination_lean_corpus)'`.
