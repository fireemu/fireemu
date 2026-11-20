import TypeIdentifiers.Theorems

/-! Guard that the specification proofs use only Lean's standard axioms. -/

/-- info: 'TI.admits_within_limit' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TI.admits_within_limit

/-- info: 'TI.document_collection_same' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TI.document_collection_same

/-- info: 'TI.default_database_but_not_project' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TI.default_database_but_not_project

/-- info: 'TI.slash_precedes_control_on_path_segments' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms TI.slash_precedes_control_on_path_segments

/-- info: 'TI.offsets_count_utf8_bytes' does not depend on any axioms -/
#guard_msgs in #print axioms TI.offsets_count_utf8_bytes
