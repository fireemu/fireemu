# Runner invocation budgets in Lean 4

The model describes reservation and release as pure transitions. A successful reservation receives a fresh abstract lease identity. The public identifier may be reused after release, while an older lease remains tied to its own identity. The byte charge is the sum of active payload lengths. A refusal closes subsequent admission and leaves existing leases available for release.

Theorems cover the count and byte caps after acceptance, refusal stability, error precedence and exact lease selection. Release is idempotent and preserves a newer lease carrying the same public identifier. The corpus crosses small explicit caps and ordered traces. The Node test calls the public constructor, reserve method and returned release closures and observes the state after each command. Input types are UTF-16 string identifiers and nonnegative integral byte counts. Frame decoding and runner execution are separate contracts.

From this directory, regenerate the corpus as follows.

~~~sh
lake build
lake exe corpus > ../../../tools/runner-node/tests/fixtures/lean-runner-invocation-budget.corpus
cd ../../..
node --test tools/runner-node/runner-invocation-budget-lean-corpus.test.mjs
~~~
