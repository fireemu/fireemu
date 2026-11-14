# ADR-001: Core crates prefer std-only dependencies

- Status: accepted (2026-08-29)

## Decision

`fireemu-core-*` crates avoid normal external dependencies by default and forbid `unsafe`, expose
no async runtime types, never read wall-clock time, thread-local RNGs or environment variables,
and return typed errors instead of panicking on input. `HashMap` iteration order carries no
meaning; canonical output uses `BTreeMap` or explicit sorting.

The only normal external dependency exception is `crc32c` 0.6.9 in `fireemu-core-types`. Its safe
API performs runtime hardware detection with a software fallback, preserving the core crate's
`unsafe` prohibition while substantially reducing CRC32C cost. No other core crate may depend on
it or gain an external dependency without a separate ADR amendment.

## Consequences

- The core can be checked by Kani, Proptest, cargo-fuzz and mutation testing without I/O stubs.
- Most functionality that needs a dependency (JSON, protobuf, time zones, networking) lives in
  an adapter crate. `scripts/check-core-deps.sh` enforces the exact core dependency allowlist.
- Convenience crates (error boxing, derive helpers, global singletons) are not admitted.
