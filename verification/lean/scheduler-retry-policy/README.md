# Cloud Scheduler retry policy projection

The reference models the adapter's projection from manifest retry settings to a local retry policy. First-generation handlers receive one attempt and no window. Second-generation counts include the initial attempt, saturating at the unsigned 32-bit limit. The backoff pair defaults only when both members are zero. A zero doubling count defaults independently. Durations are clamped to the signed seconds range before converting to nanoseconds.

The proofs cover generation isolation, normalized backoff order, the delay cap, count sufficiency, and the inclusive window boundary after the count is spent. Job creation refusal at a retry count of six is a separate decision. The delay reference uses a capped mathematical expression. It implements the runtime's early cap for shifts starting at 120. For projected configurations the policy cap fits signed 128-bit arithmetic, so backoff overflow also reaches the mathematical cap.

The corpus crosses generation, count, window, backoff pair, and doubling setting. Each configuration probes representative attempts, the final in-window nanosecond and its successor, and elapsed values at the signed arithmetic ceiling. The Rust replay runs the actual scheduler projection, retry-policy decisions, and manifest refusal method. The model takes elapsed time and attempt as inputs and leaves dispatch, timer delivery, and manifest JSON parsing outside its scope.

From this directory, regenerate the checked-in fixture with the pinned Lean toolchain.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-scheduler-retry-policy.corpus
```

From the workspace root, replay the fixture without Lean.

```sh
cargo nextest run -p fireemu-adapter-functions -E 'binary(scheduler_retry_policy_lean_corpus)'
```
