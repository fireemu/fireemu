# The virtual clock in Lean 4

A Lean 4 specification of `VirtualClock` in `crates/fireemu-core-session/src/clock.rs` as a pure
state machine, machine-checked properties of it, and an executable reference that writes the
golden traces the Rust tests replay against the real clock. The Rust build and tests do not need
Lean.

## Layout

- `VirtualClock/Spec.lean`: the state (`St`: the published instant, the mode with the anchor
  reading and the high-water mark of a following clock, the wall clock, `backwards_sets`, the
  elapsed budget, the revision and the range), the operations (`Op`) and the transition function
  `step`, with the time-source reading and the wall instant as inputs of each step. Integers are
  unbounded; every saturation, check and clamp of the Rust code is written out, and unchecked
  `i128` arithmetic that can overflow is a `none` result (a panic with overflow checks).
- `VirtualClock/Laws.lean`: the invariant `WF`, what one sample and one publication do
  (`sample_facts`, `publish_facts`), and `step_shape`, which sorts every step into one of four
  shapes (unchanged, sampled, ranged, published).
- `VirtualClock/Theorems.lean`: the properties, among them `never_backwards_uncounted`,
  `reads_never_go_back`, `refused_changes_nothing`, `frozen_stands_still`,
  `freeze_then_resume_keeps_the_instant`, `freeze_idempotent`, `resume_idempotent`,
  `published_in_range`, `read_in_range`, `budget_monotone`, `last_revision_refuses`,
  `publication_within_budget` and `over_budget_refused`, and two counterexamples
  (`read_steps_back_at_the_i128_top`, `read_below_the_range_minimum`) that show where the
  monotonicity and range properties need their hypothesis.
- `VirtualClock/Axioms.lean`: a build-time guard that the theorems depend only on Lean's standard
  axioms (no `sorry`).
- `Main.lean`: the trace generator (the format is in its header comment).

## What the counterexamples say

`sample_at` adds the drift with `checked_add` and falls back to the last published instant when
the sum overflows `i128`. Near `i128::MAX` a following clock therefore reads an earlier instant
once the drift overflows, without counting a rewind, and a range set while the clock read later
than its last publication can then be undercut. Both need an instant or a drift within one drift
of the `i128` range, which a wall-clock or monotonic source does not reach; the corpus has a trace
for each and the Rust tests pin the behaviour.

## Commands

The toolchain is pinned in `lean-toolchain`; `elan` downloads it on first use.

```sh
lake build                 # checks every proof and builds the generator
lake exe corpus > ../../../crates/fireemu-core-session/tests/fixtures/lean-virtual-clock.corpus
```

The Rust side is `crates/fireemu-core-session/tests/clock_lean_corpus.rs`: it replays every
trace through the public API with an injected `TimeSource` and `WallSource`, and states the
proved properties as proptest properties over random operation sequences. Regenerate the corpus
after changing `Main.lean` or the specification, and commit both.
