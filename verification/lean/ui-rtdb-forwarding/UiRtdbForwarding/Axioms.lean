import UiRtdbForwarding.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'UIR.oversized_body_refused_before_parameter_parsing' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms UIR.oversized_body_refused_before_parameter_parsing

/-- info: 'UIR.configured_ownership_overrides_name_inference' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms UIR.configured_ownership_overrides_name_inference

/-- info: 'UIR.plus_is_literal' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms UIR.plus_is_literal

/-- info: 'UIR.methods_for_rules' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms UIR.methods_for_rules

/-- info: 'UIR.anonymous_action_has_no_owner_privilege' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms UIR.anonymous_action_has_no_owner_privilege
