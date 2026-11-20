import PythonRunnerWireLayout.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'PyWire.ordering_preserves_fields' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.ordering_preserves_fields

/-- info: 'PyWire.compact_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.compact_order

/-- info: 'PyWire.pubsub_fields_are_sorted' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.pubsub_fields_are_sorted

/-- info: 'PyWire.nested_storage_fields_are_sorted' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.nested_storage_fields_are_sorted

/-- info: 'PyWire.numeric_wire_lexeme' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.numeric_wire_lexeme

/-- info: 'PyWire.numeric_body_lexeme' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.numeric_body_lexeme

/-- info: 'PyWire.empty_aggregates_stay_single_line' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.empty_aggregates_stay_single_line

/-- info: 'PyWire.known_before_unknown' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.known_before_unknown

/-- info: 'PyWire.unknown_members_use_lexical_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyWire.unknown_members_use_lexical_order
