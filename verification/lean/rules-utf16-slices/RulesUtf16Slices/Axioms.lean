import RulesUtf16Slices.Spec

/-! Guard the standard Lean axiom dependencies of the model theorems. -/

/-- info: 'RulesUtf16Slices.left_edge_never_cuts' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesUtf16Slices.left_edge_never_cuts

/-- info: 'RulesUtf16Slices.right_edge_never_cuts' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesUtf16Slices.right_edge_never_cuts

/-- info: 'RulesUtf16Slices.full_slice_keeps_units' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RulesUtf16Slices.full_slice_keeps_units

/-- info: 'RulesUtf16Slices.interior_empty_slice' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RulesUtf16Slices.interior_empty_slice

/-- info: 'RulesUtf16Slices.empty_at_zero_rejected' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RulesUtf16Slices.empty_at_zero_rejected

/-- info: 'RulesUtf16Slices.official_selection_keeps_exact_width' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesUtf16Slices.official_selection_keeps_exact_width

/-- info: 'RulesUtf16Slices.uncut_selection_same_in_both_profiles' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesUtf16Slices.uncut_selection_same_in_both_profiles

/-- info: 'RulesUtf16Slices.cut_pair_regression' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesUtf16Slices.cut_pair_regression
