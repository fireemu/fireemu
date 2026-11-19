import StoragePrecondition.Theorems

/-!
Build-time guard: the theorems use only Lean's standard axioms. A new axiom or an unfinished
proof changes the printed list and fails the build.
-/

/-- info: 'SP.check_iff_all_pass' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SP.check_iff_all_pass

/-- info: 'SP.decide_iff_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SP.decide_iff_spec

/-- info: 'SP.verdict_exists_unique' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SP.verdict_exists_unique

/-- info: 'SP.decision_depends_only_on_object' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.decision_depends_only_on_object

/-- info: 'SP.order_independent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SP.order_independent

/-- info: 'SP.generation_match_not_match_exclusive' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.generation_match_not_match_exclusive

/-- info: 'SP.metageneration_match_not_match_exclusive' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.metageneration_match_not_match_exclusive

/-- info: 'SP.zero_match_iff_absent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SP.zero_match_iff_absent

/-- info: 'SP.raw_zero_generation_passes_zero_match' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.raw_zero_generation_passes_zero_match

/-- info: 'SP.absent_guard' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.absent_guard

/-- info: 'SP.absent_read' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.absent_read

/-- info: 'SP.absent_write_rules' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SP.absent_write_rules

/-- info: 'SP.absent_read_differs_from_live_mutations' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.absent_read_differs_from_live_mutations

/-- info: 'SP.failed_match_takes_priority' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.failed_match_takes_priority

/-- info: 'SP.refused_preserves_object_state' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SP.refused_preserves_object_state

/-- info: 'SP.finalize_refusal_aborts' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SP.finalize_refusal_aborts

/-- info: 'SP.refused_finalize_changes_session' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.refused_finalize_changes_session

/-- info: 'SP.exhausted_identity_can_refuse_after_guards_pass' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.exhausted_identity_can_refuse_after_guards_pass

/-- info: 'SP.successful_upload_generation' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SP.successful_upload_generation

/-- info: 'SP.execution_can_depend_on_counter' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.execution_can_depend_on_counter

/-- info: 'SP.stale_counter_can_repeat_generation' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.stale_counter_can_repeat_generation

/-- info: 'SP.successful_metadata_preserves_generation' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.successful_metadata_preserves_generation

/-- info: 'SP.metadata_write_keeps_generation' depends on axioms: [propext] -/
#guard_msgs in #print axioms SP.metadata_write_keeps_generation
