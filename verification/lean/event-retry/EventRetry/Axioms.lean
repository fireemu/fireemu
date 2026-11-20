import EventRetry.Theorems

/-! Build-time checks for the permitted Lean axioms. -/

/-- info: 'EventRetry.backoff_le_cap' depends on axioms: [propext] -/
#guard_msgs in #print axioms EventRetry.backoff_le_cap

/-- info: 'EventRetry.first_backoff' depends on axioms: [propext] -/
#guard_msgs in #print axioms EventRetry.first_backoff

/-- info: 'EventRetry.attempts_override_age' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventRetry.attempts_override_age

/-- info: 'EventRetry.no_window_uses_attempts' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventRetry.no_window_uses_attempts

/-- info: 'EventRetry.last_age_inclusive' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EventRetry.last_age_inclusive

/-- info: 'EventRetry.exhausted_and_too_late' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventRetry.exhausted_and_too_late

/-- info: 'EventRetry.exhausted_with_overflow' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventRetry.exhausted_with_overflow

/-- info: 'EventRetry.doubling_cutoff_is_observable' does not depend on any axioms -/
#guard_msgs in #print axioms EventRetry.doubling_cutoff_is_observable
