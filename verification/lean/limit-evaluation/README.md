# Limit evaluation in Lean 4

This model specifies the outcome ordering and integer arithmetic of `crates/fireemu-core-limits/src/evaluate.rs`, plus maximum resolution from `src/plan.rs`. It covers all six boundary styles, request refusal versus observation, the default warning thresholds, effective maxima under billing and matched support overrides, and saturating usage ratios. The model uses mathematical naturals for the basis-point comparison and returns a capped 32-bit ratio. Warning policy input is fixed to the published default thresholds. Catalog generation, custom thresholds, and nonnumeric syntax validation are outside the model.

`LimitEvaluation/Theorems.lean` proves monotonic threshold detection, ratio saturation, boundary checks taking precedence over warnings, exclusive equality refusal, observe-stage behavior, truncating boundaries, an absent numeric maximum, and matched override precedence.

`Main.lean` emits tab-separated rows with boundary, maximum profile, enforcement stage, amount class, usage, effective maximum, three threshold results, ratio, and disposition. Exact comparisons are exercised at each warning threshold, with zero maxima and maxima beyond native multiplication width. The Rust replay checks the public outcome and warning or refusal metadata.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-limits/tests/fixtures/lean-limit-evaluation.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-limits --test limit_evaluation_lean_corpus`. The Rust replay uses the checked-in fixture alone.
