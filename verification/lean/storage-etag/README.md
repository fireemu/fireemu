# Cloud Storage ETags in Lean 4

`StorageEtag/Spec.lean` specifies the wire format implemented by `crates/fireemu-core-storage/src/etag.rs`. A bucket message carries the metageneration at tag 8. An object message carries the generation at tag 8 and the metageneration at tag 16. The two forms use the same base-128 field representation and standard padded base64 serialization.

The proofs recover every unsigned 64-bit value from its varint while preserving arbitrary following bytes. They also establish uniqueness of encoded varints, exact field boundaries, the base64 quartet length, and the recorded object and bucket examples. Separate roles for the payload decoder and the string renderer keep the byte-level claim explicit.

The corpus crosses the 36 selected generation and metageneration boundary values, including both sides of all nine base-128 transitions and the largest unsigned 64-bit value. The fixture writes the expected base64 string as dot-separated decimal ASCII octets. The Rust replayer compares the exact bytes, including padding, against each public encoder.

## Commands

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-storage/tests/fixtures/lean-storage-etag.corpus
```

From the repository root, run `cargo test -p fireemu-core-storage --test storage_etag_lean_corpus`.
