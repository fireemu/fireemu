import SessionTenancy.Theorems

/-! Checks the axioms used by the exported correctness statements. -/

/-- info: 'ST.refusal_is_atomic' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ST.refusal_is_atomic

/-- info: 'ST.acceptance_has_complete_registration' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ST.acceptance_has_complete_registration

/-- info: 'ST.registered_scope_does_not_inherit_default' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ST.registered_scope_does_not_inherit_default

/-- info: 'ST.fallback_scope_is_complement' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ST.fallback_scope_is_complement

/-- info: 'ST.open_keys_are_never_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ST.open_keys_are_never_refused

/-- info: 'ST.recognized_suffix_takes_priority' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ST.recognized_suffix_takes_priority
