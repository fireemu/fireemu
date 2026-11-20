import RunnerWaitDeadlines.Theorems

/-! Records the axioms of the exported reference theorems. -/

/-- info: 'RunnerWaitDeadlines.allowance_never_exceeds_cap' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.allowance_never_exceeds_cap

/-- info: 'RunnerWaitDeadlines.exact_cap_is_not_too_loaded' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.exact_cap_is_not_too_loaded

/-- info: 'RunnerWaitDeadlines.above_cap_has_plateau' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.above_cap_has_plateau

/-- info: 'RunnerWaitDeadlines.safe_sum_preserved' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.safe_sum_preserved

/-- info: 'RunnerWaitDeadlines.invalid_quiet_precedes_margin' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.invalid_quiet_precedes_margin

/-- info: 'RunnerWaitDeadlines.ready_precedes_every_timeout' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.ready_precedes_every_timeout

/-- info: 'RunnerWaitDeadlines.failed_poll_skips_progress' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.failed_poll_skips_progress

/-- info: 'RunnerWaitDeadlines.stalled_takes_priority_over_hard_limit' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.stalled_takes_priority_over_hard_limit

/-- info: 'RunnerWaitDeadlines.progress_does_not_extend_hard_limit' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.progress_does_not_extend_hard_limit

/-- info: 'RunnerWaitDeadlines.progress_resets_stall_window' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerWaitDeadlines.progress_resets_stall_window
