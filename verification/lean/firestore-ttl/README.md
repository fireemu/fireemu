# Firestore time-to-live decisions

The Lean reference covers three deterministic parts of TTL in `ttl.rs`: expiration-offset parsing, field expiry, and logical-clock conversion to a representable Firestore timestamp. A valid offset denotes a whole number of seconds from zero through 2,147,483,647. A structurally valid nonzero fraction is rejected for precision before the whole seconds are checked for range. Fractional zeros and negative zero normalize to the same seconds-only spelling as ordinary zero.

The proofs establish the exact offset admission bound, the absence of expiry for missing or non-timestamp values, and equivalence of omitted and explicit-zero offsets for expiry. For a valid comparison instant, saturating addition gives the same strict expiry predicate as unbounded integer addition. Equality with the expiry instant keeps the document. Increasing the instant can only add expired documents, and increasing the offset can only delay expiration. Logical-clock conversion stays within the timestamp range and preserves representable instants.

The Rust replay checks public APIs on exact nanosecond boundaries, endpoints, unrepresentable clock instants, and direct, nested, missing, or wrong-type field values. Offset rows check result variants, values, and round-trips through canonical seconds-only formatting. Saturation rows also exercise the full signed duration type available to the lower-level expiry helper, beyond the restricted range of the configuration parser. The tests do not model policy mutation, sweep scheduling, or deletion.

## Reproduce

From this directory with the pinned Lean toolchain:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-ttl.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_ttl_lean_corpus
```
