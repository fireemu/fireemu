import DocumentSize.Theorems

/-! Build-time guards for every theorem, allowing only Lean's standard axioms. -/

/-- info: 'DS.checked_add_exact' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DS.checked_add_exact

/-- info: 'DS.add_overflow_iff' depends on axioms: [propext] -/
#guard_msgs in #print axioms DS.add_overflow_iff

/-- info: 'DS.string_size_exact' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DS.string_size_exact

/-- info: 'DS.segment_size_exact' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DS.segment_size_exact

/-- info: 'DS.document_name_size_exact' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DS.document_name_size_exact

/-- info: 'DS.reference_size_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.reference_size_exact

/-- info: 'DS.field_value_size_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.field_value_size_exact

/-- info: 'DS.array_size_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.array_size_exact

/-- info: 'DS.fields_size_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.fields_size_exact

/-- info: 'DS.document_size_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.document_size_exact

/-- info: 'DS.indexed_value_size_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.indexed_value_size_exact

/-- info: 'DS.indexed_value_size_within_bound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.indexed_value_size_within_bound

/-- info: 'DS.indexed_fields_size_within_bound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.indexed_fields_size_within_bound

/-- info: 'DS.index_entry_size_within_bound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.index_entry_size_within_bound

/-- info: 'DS.index_entry_overflow_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.index_entry_overflow_iff

/-- info: 'DS.array_bytes_append' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.array_bytes_append

/-- info: 'DS.fields_bytes_append' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.fields_bytes_append

/-- info: 'DS.fields_bytes_perm' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.fields_bytes_perm

/-- info: 'DS.array_concat_size' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.array_concat_size

/-- info: 'DS.disjoint_map_union_size' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.disjoint_map_union_size

/-- info: 'DS.array_size_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.array_size_monotone

/-- info: 'DS.map_size_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.map_size_monotone

/-- info: 'DS.document_size_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.document_size_monotone

/-- info: 'DS.value_overflow_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.value_overflow_iff

/-- info: 'DS.document_overflow_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.document_overflow_iff

/-- info: 'DS.array_append_can_overflow' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.array_append_can_overflow

/-- info: 'DS.overlapping_map_union_can_shrink' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.overlapping_map_union_can_shrink

/-- info: 'DS.indexed_cap_does_not_hide_overflow' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.indexed_cap_does_not_hide_overflow

/-- info: 'DS.empty_single_field_index_refuses' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.empty_single_field_index_refuses

/-- info: 'DS.document_size_accepts_above_one_mib' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.document_size_accepts_above_one_mib

/-- info: 'DS.reference_strips_namespace_in_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.reference_strips_namespace_in_order

/-- info: 'DS.reference_fallback_keeps_empty_segments' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.reference_fallback_keeps_empty_segments

/-- info: 'DS.single_field_index_ignores_extra_fields' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms DS.single_field_index_ignores_extra_fields
