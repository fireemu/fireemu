import SessionFault.Theorems

/-! Build-time checks for the permitted Lean axioms. -/

/-- info: 'SessionFault.preserves_rule_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SessionFault.preserves_rule_order

/-- info: 'SessionFault.overlapping_matches_are_both_retained' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SessionFault.overlapping_matches_are_both_retained

/-- info: 'SessionFault.no_plan_records_nothing' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SessionFault.no_plan_records_nothing

/-- info: 'SessionFault.retained_length' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SessionFault.retained_length

/-- info: 'SessionFault.fits_keeps_all' depends on axioms: [propext] -/
#guard_msgs in #print axioms SessionFault.fits_keeps_all

/-- info: 'SessionFault.retention_conserves_history' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SessionFault.retention_conserves_history

/-- info: 'SessionFault.event_filter_does_not_scope_the_counter' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SessionFault.event_filter_does_not_scope_the_counter
