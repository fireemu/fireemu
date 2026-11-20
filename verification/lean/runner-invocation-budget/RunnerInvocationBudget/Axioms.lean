import RunnerInvocationBudget.Theorems

/-- info: 'RunnerInvocationBudget.accepted_respects_caps' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerInvocationBudget.accepted_respects_caps

/-- info: 'RunnerInvocationBudget.refused_leaves_active_leases' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerInvocationBudget.refused_leaves_active_leases

/-- info: 'RunnerInvocationBudget.failed_reservation_is_closed' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerInvocationBudget.failed_reservation_is_closed

/-- info: 'RunnerInvocationBudget.release_membership' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerInvocationBudget.release_membership

/-- info: 'RunnerInvocationBudget.release_idempotent' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RunnerInvocationBudget.release_idempotent

/-- info: 'RunnerInvocationBudget.release_preserves_later_identity' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerInvocationBudget.release_preserves_later_identity

/-- info: 'RunnerInvocationBudget.duplicate_precedes_both_caps' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerInvocationBudget.duplicate_precedes_both_caps
