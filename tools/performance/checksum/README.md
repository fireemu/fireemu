# CRC32C hardware experiment

This standalone Cargo workspace compares a source snapshot of the pre-integration `fireemu-core-types` slicing-by-eight CRC32C implementation, Rust intrinsics, C intrinsics through FFI, and `crc32c` 0.6.9. The snapshot is `src/frozen_core_hash.rs`; it does not import the live production module. It is not production integration.

The workspace is intentionally isolated with its own `[workspace]` declaration and lockfile. The Rust package keeps the root project MSRV declaration (`1.85`); the dependency candidate provides safe finalized-CRC append semantics, which the adapter converts to and from raw state using bitwise complement. The test oracle independently applies reflected polynomial `0x82f63b78` one bit at a time.

The small TLA+ model abstracts the byte update arithmetic to an 8-bit deterministic transition. It checks the incremental chunk scheduler's prefix ordering and completion equality; the differential Rust tests are the proof check for CRC32C arithmetic and raw-state semantics.

The native C translation unit contains only target-attributed hardware functions. It has no global `-march=native` or equivalent flags. Runtime detection in Rust must succeed before the FFI function is called. C loads each eight-byte word from exactly eight bytes using explicit little-endian byte assembly, then processes the remainder byte by byte.

The benchmark allocates each input before timing and reports raw per-sample nanoseconds along with the selected backend, input size, workload, partition, iterations, CRC32C result, and MD5 result. The four workloads separate CRC-only from MD5-plus-CRC and one-shot from 997-byte incremental processing. The fixed timing size set is 0, 7, 8, 64, 4096, 1 MiB, and 30 MiB. The differential PICT model additionally covers 768-byte and 24,576-byte long-path inputs. The baseline MD5 implementation is loaded from the immutable pre-integration source snapshot.

## Source audit

`crc32c` 0.6.9 is a maintained safe-facing dependency candidate. Its [official API documentation](https://docs.rs/crc32c/latest/crc32c/) identifies CRC-32C and exposes append semantics. Its [published dispatch source](https://docs.rs/crc32c/latest/src/crc32c/lib.rs.html) calls x86-64 SSE4.2 code only after runtime feature detection, calls AArch64 CRC code only after runtime feature detection when `armsimd` is enabled, and otherwise uses its software implementation. The AArch64 CRC intrinsics stabilized in Rust 1.80, so this path is compatible with the repository's declared 1.85 MSRV. The crate's build dependency is `rustc_version`; inspect the generated independent lockfile for its resolved transitive dependencies.

`crc-fast` 1.10.0 was reviewed as another maintained accelerated API, but its [published package manifest](https://docs.rs/crate/crc-fast/1.10.0/source/Cargo.toml.orig) sets `rust-version = "1.89"`. It is therefore excluded from this candidate comparison because it exceeds the repository's Rust 1.85 MSRV.

## Bounded commands

Run from the main checkout so the campaign's FIFO semaphore is shared. Check that `docs.local/runs/QUIET-WINDOW` is absent before every command. Wait for an assigned slot before builds or tests; the parent controls exclusive measurement timing.

```sh
RUSTC_WRAPPER= docs.local/tools/heavy-slot run --lane codex-checksum-followup -- python3 docs.local/logs/2026-11-14/performance-followup/bounded-run.py --rss-mib 8192 --seconds 1800 -- rustup run 1.89.0-aarch64-apple-darwin cargo test --manifest-path .worktree/perf-checksum-followup/tools/performance/checksum/Cargo.toml --target-dir .worktree/perf-checksum-followup/target/checksum-experiment --locked
```

The actual multi-size timing run uses the separately built release executable under a slot request for all four campaign slots, after the parent confirms all other heavy jobs have drained. The benchmark writes tab-separated raw samples to `docs.local/logs/2026-11-14/performance-followup/checksum/raw-samples.tsv`; `measure.py` derives medians, p95, and maxima without discarding the source rows.

## HTTP upload attribution

`upload.mjs` compares frozen baseline and candidate release binaries using five fresh paired `createTestWorld` processes. It alternates start and upload order, excludes startup and one warm-up upload, and times each complete loopback upload response. Sizes are 0, 7, 8, 64, 4096, 1 MiB, and 30 MiB. It independently computes MD5 and bitwise CRC32C, checks the upload response and stored metadata, downloads and hashes every stored object, and verifies each test world removed its process and directory. It prints the exact binary SHA256 values, startup observations, raw upload latencies, and per-size medians and descriptive p95 values as JSON.

Set `FIREEMU_BASELINE_BINARY`, `FIREEMU_CANDIDATE_BINARY`, `FIREEMU_BASELINE_SHA256`, and `FIREEMU_CANDIDATE_SHA256` from the two build receipts, then run `node tools/performance/checksum/upload.mjs` in the assigned quiet timing window. The JSON output contains the script's own SHA-256 and the optional `CHECKSUM_UPLOAD_HARNESS_COMMIT` source pin, plus both binary hashes. The script rejects non-loopback endpoints and stores all temporary test worlds under the worktree's `target/` directory. `CHECKSUM_UPLOAD_PAIRS` and `CHECKSUM_UPLOAD_SIZES` can narrow a run for a non-performance smoke; they default to five pairs and the full size set.

## Offline regression checks

Run `node --test tools/performance/checksum/upload.test.mjs` to verify that failed startup preserves a pre-existing PID-named directory, removes only the newly allocated root, and reports the original error. The test automatically enables experimental VM module support in a child process when needed. World startup is stubbed; no server or network request is started.

Run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tools/performance/checksum/test_software.py` to replay the production CRC32C oracle tests against the pinned dependency's software fallback. The test uses offline Cargo metadata to locate cached `crc32c` 0.6.9, copies it into an owned temporary directory, and makes both CPU feature checks false in that copy. The software algorithm and generated tables remain unchanged. It copies the production hash source and workspace lockfile, then runs its existing short/long boundary, alignment, raw-state, chunking, finalization, and property tests, with build output under `target/checksum-software`. It uses `heavy-slot run --lane codex` when `docs.local/tools/heavy-slot` exists beside the shared Git directory, and otherwise runs Cargo directly, so a clean checkout needs no private wrapper. It requires all four expected tests to pass by name and checks their nonzero passed count. Only the owned temporary directory is removed. This exercises unsupported-feature dispatch on the host architecture; x86 hardware coverage still requires an x86 host.
