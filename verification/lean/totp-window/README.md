# The TOTP window in Lean 4

A Lean 4 specification of `match_code` and `match_step_window` in `crates/fireemu-core-auth/src/mfa.rs` and the `time_step`, `hotp`, `totp_at` and code display in `current_code` from `crates/fireemu-core-auth/src/totp.rs`. It includes machine-checked proofs and an executable reference that writes the golden corpus. The Rust build and tests do not need Lean.

## Layout

- `TotpWindow/Spec.lean` models Unix nanoseconds, the saturating counter and inclusive window, replay and detached-factor handling, dynamic truncation and decimal formatting. The HMAC takes eight big-endian counter bytes and returns a 20-byte digest. The caller fixes the key and the hash stays abstract.
- `TotpWindow/Theorems.lean` proves the clamped and unclamped floor formulas, monotonicity, constancy within a period, safe window bounds, first-fresh acceptance, rejection in the absence of an in-window match, truncation bounds and decimal padding. It also checks the counterexamples below.
- `TotpWindow/Axioms.lean` guards the permitted Lean axioms at build time.
- `Main.lean` documents and generates the corpus. It checks the six RFC 6238 SHA-1 display codes against the reference, uses fixed public test MACs covering all 16 offsets and refuses to generate a case if a needed digest is missing.

## Findings

- At `-1 ns` with a 30-second period, the signed floor is `-1` and the Rust counter is `0` (`pre_epoch_clamps`). At `553402322211286548480000000000 ns` with the same period, the floor is `u64::MAX + 1` and the counter is `u64::MAX` (`counter_saturates_above_u64`). The unclamped floor equality holds for nonnegative instants with a positive period and a floor that fits. A zero period always returns `0` (`zero_period_returns_zero`).
- The public digit field admits every `u8` value. At counter `0`, `digits = 0` displays `"0"` and `digits = 10` displays nine characters (`zero_digits_displays_zero`, `ten_digits_displays_nine`). The code is below `10^digits` for every digit count and the display is exactly `digits` characters for `1 ≤ digits ≤ 9`.
- With a 30-second period at `30 s`, a zero-step window and `digits = 0`, counters `1` and `2` both produce `0`. A submission of `0` is accepted at counter `1` even when generated at counter `2` (`outside_code_can_collide`). With last accepted counter `1`, that code is classified as replayed (`replay_can_refuse_a_matching_code`). The exact acceptance condition requires a matching, fresh in-window counter and an attached factor. A numeric code carries no originating counter.
- The Lean corpus records these behaviors directly. The Rust replay checks every row against the public API and has named regressions for the findings.

## Open

Rust's public `hotp` always computes its own HMAC, so the Rust tests exercise truncation with recorded and generated real HMAC digests. Lean proves the truncation bound for every 20-byte digest. The remaining-validity value from `current_code` is specified by the clamped whole-second remainder. The proof establishes the inclusive countdown bound, before-epoch clamp and zero-period display fallback.

## Commands

The Lean 4 version is pinned in `lean-toolchain`.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-auth/tests/fixtures/lean-totp-window.corpus
```

The Rust side is `crates/fireemu-core-auth/tests/totp_window_lean_corpus.rs`. It replays every case through the public API and uses the crate's `proptest` development dependency to check the corresponding properties against arithmetic and bounded-window references.
