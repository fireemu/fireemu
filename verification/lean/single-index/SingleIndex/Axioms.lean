import SingleIndex.Counterexamples

/-! The proofs may use only Lean standard axioms. -/

/-- info: 'SI.Direction.flip_flip' does not depend on any axioms -/
#guard_msgs in #print axioms SI.Direction.flip_flip

/-- info: 'SI.Mode.flip_flip' depends on axioms: [propext] -/
#guard_msgs in #print axioms SI.Mode.flip_flip

/-- info: 'SI.equality_prefix_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.equality_prefix_iff

/-- info: 'SI.composite_complete' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.composite_complete

/-- info: 'SI.composite_explicit_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.composite_explicit_iff

/-- info: 'SI.required_index_serves' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SI.required_index_serves

/-- info: 'SI.required_index_accepted' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.required_index_accepted

/-- info: 'SI.capacity_and_necessity_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.capacity_and_necessity_iff

/-- info: 'SI.required_index_creatable' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.required_index_creatable

/-- info: 'SI.automatic_single_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.automatic_single_iff

/-- info: 'SI.automatic_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.automatic_mono

/-- info: 'SI.automatic_scope' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.automatic_scope

/-- info: 'SI.composite_collection_cannot_serve_group' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.composite_collection_cannot_serve_group

/-- info: 'SI.equality_only_rules' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.equality_only_rules

/-- info: 'SI.membership_only_rules' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.membership_only_rules

/-- info: 'SI.order_only_rules' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.order_only_rules

/-- info: 'SI.overlapping_kinds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.overlapping_kinds

/-- info: 'SI.base_priority' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.base_priority

/-- info: 'SI.base_indexed_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.base_indexed_iff

/-- info: 'SI.base_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.base_monotone

/-- info: 'SI.head_refusal_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.head_refusal_iff

/-- info: 'SI.composite_implicit_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.composite_implicit_iff

/-- info: 'SI.composite_reversed' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.composite_reversed

/-- info: 'SI.scan_filters_are_exact' does not depend on any axioms -/
#guard_msgs in #print axioms SI.scan_filters_are_exact

/-- info: 'SI.scan_order_is_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.scan_order_is_exact

/-- info: 'SI.membership_with_order_needs_two_keys' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.membership_with_order_needs_two_keys

/-- info: 'SI.head_after_base_indexed_extension' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.head_after_base_indexed_extension

/-- info: 'SI.automatic_single_result' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.automatic_single_result

/-- info: 'SI.automatic_regular_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.automatic_regular_iff

/-- info: 'SI.automatic_regular_result_serves' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.automatic_regular_result_serves

/-- info: 'SI.group_composite_serves_collection' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.group_composite_serves_collection

/-- info: 'SI.name_before_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.name_before_order

/-- info: 'SI.first_name_wins' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.first_name_wins

/-- info: 'SI.implicit_name_ignores_fixed_prefix' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.implicit_name_ignores_fixed_prefix

/-- info: 'SI.implicit_name_ignores_array_key' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.implicit_name_ignores_array_key

/-- info: 'SI.contains_covers_overlapping_equality' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.contains_covers_overlapping_equality

/-- info: 'SI.opposite_order_name_needs_composite' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.opposite_order_name_needs_composite

/-- info: 'SI.repeated_order_uses_first_direction' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.repeated_order_uses_first_direction

/-- info: 'SI.primary_key_reversal_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.primary_key_reversal_refused

/-- info: 'SI.equality_reversal_depends_on_enabled_modes' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.equality_reversal_depends_on_enabled_modes

/-- info: 'SI.head_refuses_ascending_only' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.head_refuses_ascending_only

/-- info: 'SI.required_index_can_exceed_capacity' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SI.required_index_can_exceed_capacity

/-- info: 'SI.name_before_order_reorders_documents' depends on axioms: [propext] -/
#guard_msgs in #print axioms SI.name_before_order_reorders_documents

/-- info: 'SI.contains_scan_can_admit_non_equal_array' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SI.contains_scan_can_admit_non_equal_array
