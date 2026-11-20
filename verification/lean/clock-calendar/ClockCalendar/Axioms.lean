import ClockCalendar.Theorems
import ClockCalendar.Counterexamples

/-! Build-time guard for the dependencies of every public theorem. -/

/-- info: 'CC.days_from_civil_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.days_from_civil_spec

/-- info: 'CC.civil_round_trip' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.civil_round_trip

/-- info: 'CC.month_length_bounds' does not depend on any axioms -/
#guard_msgs in #print axioms CC.month_length_bounds

/-- info: 'CC.month_start_date' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CC.month_start_date

/-- info: 'CC.month_start_succ' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_start_succ

/-- info: 'CC.month_start_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_start_mono

/-- info: 'CC.civil_day_bounds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.civil_day_bounds

/-- info: 'CC.civil_decode' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.civil_decode

/-- info: 'CC.month_step_clamps' depends on axioms: [propext] -/
#guard_msgs in #print axioms CC.month_step_clamps

/-- info: 'CC.anchor_idempotent' depends on axioms: [propext] -/
#guard_msgs in #print axioms CC.anchor_idempotent

/-- info: 'CC.next_month_is_start' depends on axioms: [propext] -/
#guard_msgs in #print axioms CC.next_month_is_start

/-- info: 'CC.day_anchor_bounds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.day_anchor_bounds

/-- info: 'CC.month_anchor_bounds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_anchor_bounds

/-- info: 'CC.year_anchor_bounds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.year_anchor_bounds

/-- info: 'CC.month_anchors_adjacent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_anchors_adjacent

/-- info: 'CC.day_anchors_adjacent' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CC.day_anchors_adjacent

/-- info: 'CC.month_index_eq' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_index_eq

/-- info: 'CC.month_step_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_step_mono

/-- info: 'CC.day_step_mono' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CC.day_step_mono

/-- info: 'CC.anchor_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.anchor_mono

/-- info: 'CC.civil_instant_injective' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.civil_instant_injective

/-- info: 'CC.month_inverse_without_clamp' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_inverse_without_clamp

/-- info: 'CC.month_steps_agree_without_first_clamp' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_steps_agree_without_first_clamp

/-- info: 'CC.bounds_of_civil' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.bounds_of_civil

/-- info: 'CC.civil_range_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.civil_range_iff

/-- info: 'CC.local_of_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.local_of_spec

/-- info: 'CC.local_resolve_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.local_resolve_spec

/-- info: 'CC.month_step_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.month_step_spec

/-- info: 'CC.day_step_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.day_step_spec

/-- info: 'CC.decision_spec' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CC.decision_spec

/-- info: 'CC.anchor_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.anchor_spec

/-- info: 'CC.clock_step_spec' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CC.clock_step_spec

/-- info: 'CC.move_clock_only' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CC.move_clock_only

/-- info: 'CC.clock_inverse' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CC.clock_inverse

/-- info: 'CC.model_sound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.model_sound

/-- info: 'CC.move_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.move_monotone

/-- info: 'CC.model_anchor_idempotent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.model_anchor_idempotent

/-- info: 'CC.model_next_month_is_start' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.model_next_month_is_start

/-- info: 'CC.reference_sound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.reference_sound

/-- info: 'CC.move_spec_unique' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.move_spec_unique

/-- info: 'CC.model_reference_agree' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CC.model_reference_agree

/-- info: 'CC.combined_year_month_differs' does not depend on any axioms -/
#guard_msgs in #print axioms CC.combined_year_month_differs

/-- info: 'CC.month_inverse_loses_clamped_day' does not depend on any axioms -/
#guard_msgs in #print axioms CC.month_inverse_loses_clamped_day

/-- info: 'CC.next_month_is_not_idempotent' does not depend on any axioms -/
#guard_msgs in #print axioms CC.next_month_is_not_idempotent

/-- info: 'CC.clock_inverse_can_leave_range' does not depend on any axioms -/
#guard_msgs in #print axioms CC.clock_inverse_can_leave_range

/-- info: 'CC.day_end_excludes_submicrosecond_tail' does not depend on any axioms -/
#guard_msgs in #print axioms CC.day_end_excludes_submicrosecond_tail

/-- info: 'CC.next_boundary_can_leave_range' does not depend on any axioms -/
#guard_msgs in #print axioms CC.next_boundary_can_leave_range

/-- info: 'CC.model_reference_agree_at_local_year_edges' does not depend on any axioms -/
#guard_msgs in #print axioms CC.model_reference_agree_at_local_year_edges
