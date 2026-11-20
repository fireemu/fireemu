# Virtual clock calendar moves in Lean 4

This project specifies `move_instant` and `decide` in `crates/fireemu-core-session/src/calendar.rs` and the Gregorian conversions in `crates/fireemu-core-types/src/time.rs`. The zone is UTC or a fixed offset in whole seconds. Duration components represent Rust's `u64` fields. The Lean arithmetic uses unbounded integers with explicit checks for Rust's integer widths. Daylight-saving gaps and folds are covered by the Rust tests against jiff.

## Specification and proofs

- `ClockCalendar/Spec.lean` states the month ordinal, day clamp, day count, elapsed nanoseconds, civil anchors, local and UTC year bounds, and backwards decision. Its Gregorian day count uses January-based month offsets.
- `ClockCalendar/Model.lean` follows Rust's March-based Gregorian formulas, Euclidean division and remainder, checked arithmetic, year checks, and ordering of the calendar, clock, and anchor stages.
- `ClockCalendar/Gregorian.lean` proves `days_from_civil_spec`, `civil_round_trip` for valid dates in years 0001–9999, and `civil_decode` for signed 64-bit day counts. The year-of-era proof checks the two endpoints of each of the 400 Gregorian years by kernel reduction and proves the quotient is monotone between those endpoints.
- `ClockCalendar/Laws.lean` proves `month_step_clamps`, `month_inverse_without_clamp`, `month_steps_agree_without_first_clamp`, `anchor_idempotent`, `next_month_is_start`, `day_anchor_bounds`, `month_anchor_bounds`, `year_anchor_bounds`, `day_anchors_adjacent`, and `month_anchors_adjacent`. The anchor laws concern represented civil results. Resolving them as fixed-offset instants preserves the equalities and inequalities.
- `ClockCalendar/Theorems.lean` connects the model to the civil contract through `local_of_spec`, `local_resolve_spec`, `month_step_spec`, `day_step_spec`, `clock_step_spec`, `anchor_spec`, and `decision_spec`. `model_sound` composes those stages for every successful model move. `clock_inverse` requires both moves to succeed. `model_anchor_idempotent` and `model_next_month_is_start` apply the civil laws to successful model moves. `move_monotone` orders successful moves from the same instant and offset with the same optional anchor by their signed month, day, and clock deltas. Increasing a single signed unit increases its corresponding delta.
- `ClockCalendar/Reference.lean` evaluates the civil rules with the verified decoder, exact calendar and clock arithmetic, the documented local range checks, and overflow reporting. `reference_sound` connects every successful reference result to the specification. `move_spec_unique` and `model_reference_agree` prove that the model and reference return the same instant whenever both succeed.
- `ClockCalendar/Counterexamples.lean` proves the findings below. `ClockCalendar/Axioms.lean` guards the dependencies of the named theorems.

## Findings

The year rule follows the Rust implementation. The result must lie in UTC years 0001–9999. A move with a nonzero calendar part checks the starting local date and every date produced by the month and day steps. An anchor checks the local date it reads and the date it produces. Clock-only and empty moves without an anchor compute no local date, so only the result's UTC year is checked. `model_reference_agree_at_local_year_edges` proves the exact results for the six boundary cases, which the Rust corpus replay also checks.

- UTC 2024-02-29 plus `P1Y1M` is 2025-03-29. Applying `P1Y` then `P1M` gives 2025-03-28 (`combined_year_month_differs`). Separate month steps agree with the combined step when the first step preserves the day.
- UTC 2024-01-31 plus `P1M` minus `P1M` is 2024-01-29 (`month_inverse_loses_clamped_day`). The inverse law for a pure month step requires the forward step to preserve the day.
- From UTC 2024-01-31, applying `startOfNextMonth` twice gives February 1 and then March 1 (`next_month_is_not_idempotent`). Applying `startOfMonth` to the February 1 result preserves it.
- From one nanosecond before UTC 0001-01-01, `PT1S` succeeds in Rust and its inverse is refused (`clock_inverse_can_leave_range`). The inverse equality applies when both moves return instants.
- The last nanosecond of UTC 2024-02-29 lies 999 ns after `endOfDay` (`day_end_excludes_submicrosecond_tail`). For UTC 9999-12-31 the end-of-month anchor exists and the next month or next day is out of range (`next_boundary_can_leave_range`). The adjacency equalities apply when both boundaries exist.

## Corpus and commands

`Main.lean` documents the five-field line format. The 780-case corpus crosses each valid 28th through 31st in leap-year 2024 with both month directions and six offsets. It also exercises all anchors, combined and fractional-start durations, UTC and local year edges, and integer overflow. The Rust replay checks the case count and canonical duration spelling, and proptest exercises the arithmetic, anchors, monotonicity, and decision rule.

Run these commands in this directory with the pinned toolchain installed.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-session/tests/fixtures/lean-clock-calendar.corpus
```

The Rust integration test is `crates/fireemu-core-session/tests/clock_calendar_lean_corpus.rs`. It uses the checked-in fixture directly.

## Open

The composed proofs establish soundness and unique successful results. They do not characterize success versus failure, or equivalence of all error paths, across the entire machine-width input domain. The corpus checks representative refusals and arithmetic overflow separately.
