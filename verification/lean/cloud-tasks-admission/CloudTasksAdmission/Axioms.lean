import CloudTasksAdmission.Theorems

/-! Checks the axioms used by the exported correctness statements. -/

/-- info: 'CTAdmission.unknown_field_wins' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTAdmission.unknown_field_wins

/-- info: 'CTAdmission.both_parse_errors_precede_payload' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTAdmission.both_parse_errors_precede_payload

/-- info: 'CTAdmission.size_callback_only_after_precheck' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTAdmission.size_callback_only_after_precheck

/-- info: 'CTAdmission.schedule_is_microsecond_aligned' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CTAdmission.schedule_is_microsecond_aligned

/-- info: 'CTAdmission.past_uses_floored_now' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTAdmission.past_uses_floored_now

/-- info: 'CTAdmission.zero_deadline_uses_default' does not depend on any axioms -/
#guard_msgs in #print axioms CTAdmission.zero_deadline_uses_default
