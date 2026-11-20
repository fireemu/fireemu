import PythonRunnerEventData.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'PySlice.first_value_wins' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.first_value_wins

/-- info: 'PySlice.ignored_member' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.ignored_member

/-- info: 'PySlice.encoded_spelling_irrelevant' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.encoded_spelling_irrelevant

/-- info: 'PySlice.no_data_from_nonobject_event' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.no_data_from_nonobject_event

/-- info: 'PySlice.locally_closed_value_is_unmodified' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.locally_closed_value_is_unmodified

/-- info: 'PySlice.missing_delimiter_refuses_value' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.missing_delimiter_refuses_value

/-- info: 'PySlice.frame_requires_data' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.frame_requires_data

/-- info: 'PySlice.frame_requires_retaining_trigger' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.frame_requires_retaining_trigger

/-- info: 'PySlice.frame_uses_same_slicer' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PySlice.frame_uses_same_slicer
