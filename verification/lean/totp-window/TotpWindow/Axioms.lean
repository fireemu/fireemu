import TotpWindow.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'TW.offset_lt' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms TW.offset_lt

/-- info: 'TW.time_step_clamped_floor' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.time_step_clamped_floor

/-- info: 'TW.time_step_floor' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.time_step_floor

/-- info: 'TW.time_step_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.time_step_monotone

/-- info: 'TW.time_step_constant_in_period' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.time_step_constant_in_period

/-- info: 'TW.pre_epoch_clamps' does not depend on any axioms -/
#guard_msgs in #print axioms TW.pre_epoch_clamps

/-- info: 'TW.counter_saturates_above_u64' does not depend on any axioms -/
#guard_msgs in #print axioms TW.counter_saturates_above_u64

/-- info: 'TW.zero_period_returns_zero' depends on axioms: [propext] -/
#guard_msgs in #print axioms TW.zero_period_returns_zero

/-- info: 'TW.truncate_lt' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms TW.truncate_lt

/-- info: 'TW.hotp_lt' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms TW.hotp_lt

/-- info: 'TW.show_code_padded' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.show_code_padded

/-- info: 'TW.show_code_width' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.show_code_width

/-- info: 'TW.zero_digits_displays_zero' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.zero_digits_displays_zero

/-- info: 'TW.ten_digits_displays_nine' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.ten_digits_displays_nine

/-- info: 'TW.window_no_overflow' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.window_no_overflow

/-- info: 'TW.time_step_window_no_overflow' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.time_step_window_no_overflow

/-- info: 'TW.match_step_window_accepted_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.match_step_window_accepted_iff

/-- info: 'TW.match_code_accepts_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.match_code_accepts_iff

/-- info: 'TW.match_code_rejects_without_in_window_match' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.match_code_rejects_without_in_window_match

/-- info: 'TW.replay_can_refuse_a_matching_code' does not depend on any axioms -/
#guard_msgs in #print axioms TW.replay_can_refuse_a_matching_code

/-- info: 'TW.outside_code_can_collide' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TW.outside_code_can_collide

/-- info: 'TW.remaining_validity_bounds' depends on axioms: [propext] -/
#guard_msgs in #print axioms TW.remaining_validity_bounds

/-- info: 'TW.before_epoch_gets_full_period' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms TW.before_epoch_gets_full_period

/-- info: 'TW.zero_period_gets_one_second' depends on axioms: [propext] -/
#guard_msgs in #print axioms TW.zero_period_gets_one_second

/-- info: 'TW.next_boundary_uses_new_full_period' does not depend on any axioms -/
#guard_msgs in #print axioms TW.next_boundary_uses_new_full_period
