import AppCheckClaims.Theorems

/-- info: 'AppCheckClaims.rounded_seconds_floor' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AppCheckClaims.rounded_seconds_floor

/-- info: 'AppCheckClaims.out_of_range_uses_maximum' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckClaims.out_of_range_uses_maximum

/-- info: 'AppCheckClaims.subsecond_negative_instant_rounds_down' does not depend on any axioms -/
#guard_msgs in #print axioms AppCheckClaims.subsecond_negative_instant_rounds_down

/-- info: 'AppCheckClaims.expiration_always_fits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AppCheckClaims.expiration_always_fits

/-- info: 'AppCheckClaims.intact_lifetime' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms AppCheckClaims.intact_lifetime

/-- info: 'AppCheckClaims.epoch_is_fixed_width' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AppCheckClaims.epoch_is_fixed_width

/-- info: 'AppCheckClaims.invalid_reasons_collapse' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckClaims.invalid_reasons_collapse

/-- info: 'AppCheckClaims.no_identity_for_invalid' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckClaims.no_identity_for_invalid

/-- info: 'AppCheckClaims.only_valid_reveals_identity' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckClaims.only_valid_reveals_identity

/-- info: 'AppCheckClaims.non_enforcement_does_not_deny' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckClaims.non_enforcement_does_not_deny
