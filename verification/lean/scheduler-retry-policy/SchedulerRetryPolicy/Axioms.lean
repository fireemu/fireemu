import SchedulerRetryPolicy.Theorems

/-! Build-time proof dependency guards. -/

/-- info: 'SRP.first_attempts' does not depend on any axioms -/
#guard_msgs in #print axioms SRP.first_attempts

/-- info: 'SRP.first_window' does not depend on any axioms -/
#guard_msgs in #print axioms SRP.first_window

/-- info: 'SRP.first_does_not_retry' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SRP.first_does_not_retry

/-- info: 'SRP.zero_backoff_pair_defaults' depends on axioms: [propext] -/
#guard_msgs in #print axioms SRP.zero_backoff_pair_defaults

/-- info: 'SRP.normalized_backoff_order' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SRP.normalized_backoff_order

/-- info: 'SRP.delay_capped' depends on axioms: [propext] -/
#guard_msgs in #print axioms SRP.delay_capped

/-- info: 'SRP.count_is_sufficient' depends on axioms: [propext] -/
#guard_msgs in #print axioms SRP.count_is_sufficient

/-- info: 'SRP.exhausted_count_and_missing_window' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SRP.exhausted_count_and_missing_window

/-- info: 'SRP.exhausted_count_and_positive_window' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SRP.exhausted_count_and_positive_window

/-- info: 'SRP.final_nanosecond_is_inclusive' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SRP.final_nanosecond_is_inclusive

/-- info: 'SRP.job_refuses_at_six' depends on axioms: [propext] -/
#guard_msgs in #print axioms SRP.job_refuses_at_six
