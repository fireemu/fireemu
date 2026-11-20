import RulesSetValues.Spec

/-! Guard the standard Lean axiom dependencies of the model theorems. -/

/-- info: 'RulesSetValues.equal_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.equal_iff

/-- info: 'RulesSetValues.integral_float_alias' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesSetValues.integral_float_alias

/-- info: 'RulesSetValues.nan_never_member_of_pair' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesSetValues.nan_never_member_of_pair

/-- info: 'RulesSetValues.equal_symm' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.equal_symm

/-- info: 'RulesSetValues.equal_trans' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.equal_trans

/-- info: 'RulesSetValues.member_nil' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesSetValues.member_nil

/-- info: 'RulesSetValues.member_cons' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesSetValues.member_cons

/-- info: 'RulesSetValues.member_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.member_iff

/-- info: 'RulesSetValues.nan_never_member' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesSetValues.nan_never_member

/-- info: 'RulesSetValues.member_append' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesSetValues.member_append

/-- info: 'RulesSetValues.member_insert' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.member_insert

/-- info: 'RulesSetValues.member_fold' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.member_fold

/-- info: 'RulesSetValues.member_distinct' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.member_distinct

/-- info: 'RulesSetValues.union_membership' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.union_membership

/-- info: 'RulesSetValues.member_congr' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.member_congr

/-- info: 'RulesSetValues.filter_membership' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.filter_membership

/-- info: 'RulesSetValues.intersection_membership' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.intersection_membership

/-- info: 'RulesSetValues.difference_membership' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesSetValues.difference_membership

/-- info: 'RulesSetValues.repeated_nan_retained' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesSetValues.repeated_nan_retained
