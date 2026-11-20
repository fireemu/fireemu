import CloudTasksTimeCodec.Theorems

/-! Checks the axioms used by the exported correctness statements. -/

/-- info: 'CTTime.split_reconstructs' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CTTime.split_reconstructs

/-- info: 'CTTime.fractional_remainder_in_bounds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CTTime.fractional_remainder_in_bounds

/-- info: 'CTTime.epoch_offset_applied' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CTTime.epoch_offset_applied

/-- info: 'CTTime.timestamp_leap_second_carries_to_midnight' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CTTime.timestamp_leap_second_carries_to_midnight

/-- info: 'CTTime.negative_fraction_does_not_round_trip' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CTTime.negative_fraction_does_not_round_trip

/-- info: 'CTTime.duration_accepts_upper_second_with_fraction' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CTTime.duration_accepts_upper_second_with_fraction
