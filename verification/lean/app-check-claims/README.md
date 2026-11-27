# App Check claim arithmetic in Lean 4

This package models the pure App Check claim constructor in `crates/fireemu-core-app-check/src/claims.rs`, the configured TTL bounds in `registry.rs`, and the already-classified admission decision in `verify.rs`. Nanoseconds divide towards negative infinity before converting to signed 64-bit seconds. Inputs outside the signed 64-bit seconds range use the current helper's maximum fallback on either side. Expiry addition and reported lifetime subtraction use signed saturation. Project number and project ID remain separate ordered audiences, and the epoch text has a fixed width.

## Proofs and coverage

The proofs establish floor rounding in range, the conversion fallback, the expiry range, exact lifetimes without saturation, fixed-width epoch text, and identity visibility only for a valid decision input. Every detailed invalid reason collapses to the same enforced public denial. The Rust replay checks the report for every input, including minimum and maximum signed times, adjacent subsecond boundaries, signed TTL extremes, both configuration limits, and all admission reasons. Inputs and identity strings are synthetic.

The model is scoped to the public helpers. The claim constructor accepts any signed TTL, while the configured registry requires a value from 1800 through 604800 seconds. Registry mutation, epoch issuance, signing, secret material, cryptographic verification, and canonical JSON rendering are outside this model.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-app-check/tests/fixtures/lean-app-check-claims.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-app-check --test integration app_check_claims_lean_corpus`. Issuance rows provide input times, TTLs, and expected claims. Admission rows give a mode, a preclassified credential, and its public decision. Configuration rows give the TTL and the expected validation result. The replay does not invoke Lean.
