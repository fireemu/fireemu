import EventarcChannelLifecycle.Theorems

/-! Build-time proof dependency guards. -/

/-- info: 'ECL.settle_monotone' depends on axioms: [propext] -/
#guard_msgs in #print axioms ECL.settle_monotone

/-- info: 'ECL.settle_keeps_high_water' does not depend on any axioms -/
#guard_msgs in #print axioms ECL.settle_keeps_high_water

/-- info: 'ECL.early_deletion_waits_for_creation' depends on axioms: [propext] -/
#guard_msgs in #print axioms ECL.early_deletion_waits_for_creation

/-- info: 'ECL.delete_twice_preserves_state' depends on axioms: [propext] -/
#guard_msgs in #print axioms ECL.delete_twice_preserves_state

/-- info: 'ECL.retirement_at_deadline' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ECL.retirement_at_deadline

/-- info: 'ECL.new_identity_when_absent' depends on axioms: [propext] -/
#guard_msgs in #print axioms ECL.new_identity_when_absent
