# Auth password policies in Lean 4

This package specifies the public `PasswordPolicy::try_new`, `violations`, and `rejects` helpers in `crates/fireemu-core-auth/src/password_policy.rs`. The model counts one UTF-16 code unit for each BMP scalar and two for each supplementary scalar. It treats ASCII case, digits, and the configured punctuation set independently, checks the length bounds inclusively, and fixes the order of violation codes. Enforcement state and forced sign-in upgrade determine whether a violation rejects an operation.

## Proofs and coverage

The theorems prove additive UTF-16 length, two-unit supplementary scalars, accepted minimum bounds, non-enforcing states, and the exact sign-in gate. `Axioms.lean` guards the permitted axioms. The corpus covers configuration error precedence, modes, sign-in, custom punctuation, all operation tags, and exact length boundaries including emoji. Configuration permits ASCII space when it is explicitly in the allowed set, although it is absent from the default punctuation set.

The model stops at the public policy helper. The hard Auth API input limit, adapter routing, credential validation, and serialization of policy options retain their separate tests.

## Reproduction

From this directory, regenerate the fixture and check the proof with the pinned Lean version.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-auth/tests/fixtures/lean-auth-password-policy.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-auth --test auth_password_policy_lean_corpus`. The first line of the fixture declares its case count. Policy rows contain the enforcement state, force flag, operation, requirement profile, candidate, ordered violations, and rejection decision. Configuration rows contain the bounds, punctuation sample, and result. The replay requires no Lean executable.
