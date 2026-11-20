# Event retry policy in Lean 4

This model specifies the public policy arithmetic in `crates/fireemu-core-events/src/retry.rs`. It covers constructor precedence, the first delivery counting against the attempt budget, exponential growth followed by the recorded two-second increment, the cap, and the union of attempt and inclusive age limits. The model uses mathematical integers for the growth formula and checks signed 128-bit representability at the age comparison.

`EventRetry/Theorems.lean` proves the cap, first backoff, sufficient attempt quota, absent-window behavior, exact-deadline acceptance, exhaustion past the deadline, and overflow behavior. It also proves the observable cutoff at 120 doublings for a zero base and nonzero cap. The cutoff reflects the current local implementation.

`Main.lean` emits the Cartesian product of named policies, attempts and elapsed values, including zero, negative, and inverted parameters, both sides of the doubling cutoff, and extrema of the Rust integer domains. Each tab-separated row starts with the three case labels, followed by the constructor arguments, the attempt number, the elapsed time, and the error tag or comma-separated backoff and retry predicates. The separate event-transition model exercises this policy's bounded state interaction. Network delivery and wall-clock execution are outside the model.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-events/tests/fixtures/lean-event-retry.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-events --test event_retry_lean_corpus`. The Rust replay uses the checked-in fixture alone.
