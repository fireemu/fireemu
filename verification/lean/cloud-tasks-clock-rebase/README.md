# Cloud Tasks clock rebasing

This model specifies the integer clock-selection function used for Cloud Tasks schedule times. Signed subtraction and addition clamp to the i128 range. Distances also clamp, including the magnitude of the minimum signed integer. A schedule moves only when it is strictly nearer the other clock. Theorems prove identity for equal clocks and ties, and preservation of the signed delay when translation fits. The corpus covers same-clock, tie, nearer-clock and signed-boundary inputs.

The Rust replayer invokes the public integer helper. Surrounding request parsing and the choice of wall or Firebase clock are outside this model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-cloud-tasks-clock-rebase.corpus
```

From the repository root, run `cargo test -p fireemu-adapter-functions --test cloud_tasks_clock_rebase_lean_corpus`.
