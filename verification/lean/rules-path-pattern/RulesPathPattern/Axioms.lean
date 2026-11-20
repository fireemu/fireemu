import RulesPathPattern.Spec

/-! Guard the standard Lean axiom dependencies of the model theorems. -/

/-- info: 'RulesPathPattern.single_exact' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesPathPattern.single_exact

/-- info: 'RulesPathPattern.single_rejects_descendants' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesPathPattern.single_rejects_descendants

/-- info: 'RulesPathPattern.nested_binds_both' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesPathPattern.nested_binds_both

/-- info: 'RulesPathPattern.trailing_captures_all' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesPathPattern.trailing_captures_all

/-- info: 'RulesPathPattern.trailing_v1_needs_a_segment' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesPathPattern.trailing_v1_needs_a_segment

/-- info: 'RulesPathPattern.leading_preserves_prefix_and_suffix' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesPathPattern.leading_preserves_prefix_and_suffix

/-- info: 'RulesPathPattern.v1_rejects_leading' does not depend on any axioms -/
#guard_msgs in #print axioms RulesPathPattern.v1_rejects_leading
