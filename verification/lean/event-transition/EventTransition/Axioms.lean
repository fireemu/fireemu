import EventTransition.Theorems

/-! Build-time checks for the permitted Lean axioms. -/

/-- info: 'EventTransition.terminal_precedes_action_validation' depends on axioms: [propext] -/
#guard_msgs in #print axioms EventTransition.terminal_precedes_action_validation

/-- info: 'EventTransition.rejection_preserves_record' depends on axioms: [propext] -/
#guard_msgs in #print axioms EventTransition.rejection_preserves_record

/-- info: 'EventTransition.terminal_stays_terminal' depends on axioms: [propext] -/
#guard_msgs in #print axioms EventTransition.terminal_stays_terminal

/-- info: 'EventTransition.interruption_returns_attempt' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventTransition.interruption_returns_attempt

/-- info: 'EventTransition.retry_at_due_time' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventTransition.retry_at_due_time

/-- info: 'EventTransition.retry_before_due_time' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventTransition.retry_before_due_time

/-- info: 'EventTransition.successful_start_charges_attempt' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventTransition.successful_start_charges_attempt
