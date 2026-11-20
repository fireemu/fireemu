# Local Auth signup quota in Lean 4

This package specifies fixed-window signup quotas in `crates/fireemu-core-auth/src/signup_quota.rs`. An hour and a temporary override are half-open intervals on the logical clock. The tracked admission decision compares committed and reserved counts against the effective limit. Observe mode records the overage and allows the reservation. Off mode leaves accounting unchanged. A tracked token may commit exactly once within its matching policy epoch, hour, and limit. A stale tracked token releases its held capacity.

## Proofs and coverage

The theorems establish the hour bounds, exclusion of an override's end, enforce and observe admission, preservation of total usage on a valid commit, and tracked release and replay behavior. `Axioms.lean` guards the permitted axioms. The generated Rust corpus checks configuration error precedence, signed clock boundaries, a held reservation, commits, releases, replays, policy reconfiguration, and temporary-limit changes. It also checks that public peer validation rejects an empty or control-bearing value in every mode.

The state model projects one key and one held reservation with a temporary probe. Counts are natural numbers, so the projection applies before saturation and token or policy-epoch wrap. Rust must also be able to represent the start of the relevant hour. Expired bucket pruning, capacity across multiple keys, snapshot behavior, and transport peer-source selection retain their separate tests. This is the local simulation contract.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-auth/tests/fixtures/lean-auth-signup-quota.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-auth --test auth_signup_quota_lean_corpus`. Configuration rows use integers and expected error tags. Window and override rows specify logical nanoseconds. Trace rows describe the initial offer, the offer while it is held, finalizer and replay outcomes, retained counts, and the next offer. The replay requires no Lean executable.
