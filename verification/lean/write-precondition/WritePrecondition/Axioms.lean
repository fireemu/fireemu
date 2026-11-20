import WritePrecondition.Counterexamples

/-! The build checks the exact axiom list of every theorem. -/

/-- info: 'WP.check_passes' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.check_passes

/-- info: 'WP.check_refuses' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.check_refuses

/-- info: 'WP.step_spec' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.step_spec

/-- info: 'WP.exactly_one_outcome' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.exactly_one_outcome

/-- info: 'WP.create_agrees_with_set_exists_false' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms WP.create_agrees_with_set_exists_false

/-- info: 'WP.update_without_precondition_iff_present' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms WP.update_without_precondition_iff_present

/-- info: 'WP.update_stage_without_precondition_iff_present' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms WP.update_stage_without_precondition_iff_present

/-- info: 'WP.absent_delete_without_precondition' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.absent_delete_without_precondition

/-- info: 'WP.absent_delete_with_exists_true' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.absent_delete_with_exists_true

/-- info: 'WP.update_time_exact' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.update_time_exact

/-- info: 'WP.commit_time_aligned' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms WP.commit_time_aligned

/-- info: 'WP.refused_write_changes_nothing' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.refused_write_changes_nothing

/-- info: 'WP.refused_batch_changes_nothing' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms WP.refused_batch_changes_nothing

/-- info: 'WP.retry_with_reported_update_time' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.retry_with_reported_update_time

/-- info: 'WP.retry_iff_changed_for_fresh_stamp' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.retry_iff_changed_for_fresh_stamp

/-- info: 'WP.missing_updates_without_precondition_upsert' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms WP.missing_updates_without_precondition_upsert

/-- info: 'WP.no_op_can_retry_with_unchanged_time' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms WP.no_op_can_retry_with_unchanged_time

/-- info: 'WP.changed_fields_advance_past_imported_time' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms WP.changed_fields_advance_past_imported_time

/-- info: 'WP.delete_can_change_existence_without_a_retry_time' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.delete_can_change_existence_without_a_retry_time

/-- info: 'WP.submicrosecond_precondition_is_not_truncated' depends on axioms: [propext] -/
#guard_msgs in #print axioms WP.submicrosecond_precondition_is_not_truncated
