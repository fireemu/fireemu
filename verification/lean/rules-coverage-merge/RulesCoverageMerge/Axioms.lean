import RulesCoverageMerge.Spec

/-! Guard the standard Lean axiom dependencies of the model theorems. -/

/-- info: 'RulesCoverageMerge.saturation_bound' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesCoverageMerge.saturation_bound

/-- info: 'RulesCoverageMerge.saturation_at_cap' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesCoverageMerge.saturation_at_cap

/-- info: 'RulesCoverageMerge.observe_bound' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesCoverageMerge.observe_bound

/-- info: 'RulesCoverageMerge.fold_preserves_bound' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesCoverageMerge.fold_preserves_bound

/-- info: 'RulesCoverageMerge.merge_bound' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesCoverageMerge.merge_bound

/-- info: 'RulesCoverageMerge.omitted_bound' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesCoverageMerge.omitted_bound

/-- info: 'RulesCoverageMerge.merge_right_identity' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesCoverageMerge.merge_right_identity

/-- info: 'RulesCoverageMerge.existing_witness_preserves_order' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesCoverageMerge.existing_witness_preserves_order

/-- info: 'RulesCoverageMerge.saturated_new_witness_is_only_omitted' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesCoverageMerge.saturated_new_witness_is_only_omitted

/-- info: 'RulesCoverageMerge.merge_association_can_lose_a_retained_count' does not depend on any axioms -/
#guard_msgs in #print axioms RulesCoverageMerge.merge_association_can_lose_a_retained_count
