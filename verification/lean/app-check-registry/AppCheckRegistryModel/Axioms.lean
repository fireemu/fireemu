import AppCheckRegistryModel.Theorems

/-- info: 'AppCheckRegistryModel.unselected_project_keeps_records' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckRegistryModel.unselected_project_keeps_records

/-- info: 'AppCheckRegistryModel.restore_capture_replaces' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckRegistryModel.restore_capture_replaces

/-- info: 'AppCheckRegistryModel.selected_uncaptured_project_is_empty' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckRegistryModel.selected_uncaptured_project_is_empty

/-- info: 'AppCheckRegistryModel.restoring_twice_is_stable' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckRegistryModel.restoring_twice_is_stable

/-- info: 'AppCheckRegistryModel.rejected_add_does_not_add_record' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckRegistryModel.rejected_add_does_not_add_record

/-- info: 'AppCheckRegistryModel.rotation_resets_numbering' does not depend on any axioms -/
#guard_msgs in #print axioms AppCheckRegistryModel.rotation_resets_numbering

/-- info: 'AppCheckRegistryModel.disabled_never_advances_counter' does not depend on any axioms -/
#guard_msgs in #print axioms AppCheckRegistryModel.disabled_never_advances_counter

/-- info: 'AppCheckRegistryModel.fresh_issue_advances_sequence' depends on axioms: [propext] -/
#guard_msgs in #print axioms AppCheckRegistryModel.fresh_issue_advances_sequence
