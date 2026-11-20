import AuthPasswordPolicy.Theorems

/-- info: 'AuthPasswordPolicy.off_never_rejects' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthPasswordPolicy.off_never_rejects

/-- info: 'AuthPasswordPolicy.unspecified_never_rejects' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthPasswordPolicy.unspecified_never_rejects

/-- info: 'AuthPasswordPolicy.signin_requires_force' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthPasswordPolicy.signin_requires_force

/-- info: 'AuthPasswordPolicy.forced_signin_agrees_with_signup' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthPasswordPolicy.forced_signin_agrees_with_signup

/-- info: 'AuthPasswordPolicy.utf16_length_additive' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthPasswordPolicy.utf16_length_additive

/-- info: 'AuthPasswordPolicy.supplementary_scalar_uses_two_units' depends on axioms: [propext] -/
#guard_msgs in #print axioms AuthPasswordPolicy.supplementary_scalar_uses_two_units

/-- info: 'AuthPasswordPolicy.valid_minimum_bounds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthPasswordPolicy.valid_minimum_bounds
