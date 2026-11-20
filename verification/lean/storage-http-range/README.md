# Cloud Storage HTTP ranges in Lean 4

`StorageHttpRange/Spec.lean` models the Cloud Storage JSON API portions of `crates/fireemu-adapter-http/src/storage.rs`. For media downloads it classifies absent and malformed Range fields, suffixes, open spans and closed spans. Its response projection includes the status, Content-Range field, and selected bytes. It keeps the strict profile's empty 206 and 416 behavior distinct from the emulator profile's whole-object fallback.

Resumable upload traces model the conversion from inclusive Content-Range endpoints to half-open spans, a declared total, the unchanged part of repeated or overlapping chunks, and status recovery from a committed session. The theorems establish clipped interval safety, positive suffix progress, recovery from a lost final response, and retry idempotence for already persisted bytes. For the unsigned 64-bit range, the maximum endpoint has no representable exclusive successor.

The fixture uses ASCII data so each scalar is exactly one byte. The Rust replay calls the public HTTP handler in process, checking statuses, range fields, refusal text where represented, and the bytes of the resulting committed object. The modeled syntax covers the rendered headers and selected malformed examples. Cancellation requests, checksums, authorization, budgets, expiry, spill, and the Firebase media route are separate contracts.

## Commands

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-http/tests/fixtures/lean-storage-http-range.corpus
```

From the repository root, run `cargo test -p fireemu-adapter-http --test storage_http_range_lean_corpus`.
