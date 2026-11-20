# Node runner wait deadlines

This package specifies the wait helper's quiet-period arithmetic, event-loop lag allowance, and virtual poll trace. The arithmetic model covers safe integer inputs, sum rounding through the range below 2^54, and strict cap equality. The corpus keeps expected sums as decimal strings for exact comparison with the integer represented by JavaScript's result.

Each scripted poll supplies a monotone time, readiness, a fail-fast event, and a natural-valued progress observation. The oracle records the terminal reason, time, and exact callback order. Lean proves that success wins the poll, fail-fast can skip the progress read, stalled wins over the absolute limit on a tie, and progress refreshes the stall timer while preserving the absolute ceiling. Replay uses a virtual clock, synthetic progress values, and in-memory callbacks.

```sh
lake build
lake exe corpus > ../../../tools/runner-node/fixtures/lean-runner-wait-deadlines.corpus
```

From the repository root, replay the corpus with `node --test tools/runner-node/load-independent-wait-lean-corpus.test.mjs`.
