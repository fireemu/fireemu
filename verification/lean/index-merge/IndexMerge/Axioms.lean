import IndexMerge.Counterexamples
import IndexMerge.HeadTheorems
import IndexMerge.Production

/-!
Build-time guard: the theorems use only Lean's standard axioms. A `sorry` (or a new axiom)
changes the printed list and fails the build.
-/

/-- info: 'IM.merged_sound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.merged_sound

/-- info: 'IM.merged_iff_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.merged_iff_spec

/-- info: 'IM.merged_none_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.merged_none_iff

/-- info: 'IM.merged_refuses_few' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.merged_refuses_few

/--
info: 'IM.merged_refuses_eq_ordered' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.merged_refuses_eq_ordered

/-- info: 'IM.merged_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.merged_mono

/-- info: 'IM.decide_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.decide_mono

/-- info: 'IM.merged_perm' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.merged_perm

/-- info: 'IM.decide_served_perm' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.decide_served_perm

/-- info: 'IM.automatic_mono' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms IM.automatic_mono

/-- info: 'IM.served_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.served_iff

/-- info: 'IM.reqOf_wf' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.reqOf_wf

/-- info: 'IM.not_exempt_of_hasMode' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms IM.not_exempt_of_hasMode

/-- info: 'IM.greedy_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.greedy_spec

/-- info: 'IM.greedy_covers' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.greedy_covers

/-- info: 'IM.candidate_of_member' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.candidate_of_member

/-- info: 'IM.member_of_candidate' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.member_of_candidate

/-- info: 'IM.servedPrefix_of_serves' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.servedPrefix_of_serves

/-- info: 'IM.spec_implies_broad' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.spec_implies_broad

/--
info: 'IM.broad_composite_with_array_field' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.broad_composite_with_array_field

/--
info: 'IM.broad_opposite_direction_automatic' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.broad_opposite_direction_automatic

/--
info: 'IM.broad_contains_with_descending_name' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.broad_contains_with_descending_name

/-- info: 'IM.broad_not_complete' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.broad_not_complete

/-- info: 'IM.members_depend_on_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.members_depend_on_order

/-- info: 'IM.one_member_merge' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.one_member_merge

/--
info: 'IM.repeated_single_equality_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.repeated_single_equality_refused

/--
info: 'IM.head_eq_base_outside_guards' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_eq_base_outside_guards

/-- info: 'IM.different_catalog_excludes_row' depends on axioms: [propext] -/
#guard_msgs in #print axioms IM.different_catalog_excludes_row

/-- info: 'IM.completion_outside_serving_catalogs' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms IM.completion_outside_serving_catalogs

/-- info: 'IM.head_eq_base_outside_serving_catalogs' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_eq_base_outside_serving_catalogs

/-- info: 'IM.guardOf_off_gate' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.guardOf_off_gate

/-- info: 'IM.head_eq_base_off_gate' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_eq_base_off_gate

/-- info: 'IM.head_eq_base_emulator' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_eq_base_emulator

/--
info: 'IM.head_eq_base_enterprise' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_eq_base_enterprise

/-- info: 'IM.head_eq_base_group_outside_guards' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_eq_base_group_outside_guards

/--
info: 'IM.recorded_refusal_iff_not_automatic_equality_serves' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.recorded_refusal_iff_not_automatic_equality_serves

/-- info: 'IM.head_override' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_override

/-- info: 'IM.first_attempt_kept' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.first_attempt_kept

/-- info: 'IM.base_merge_kept' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.base_merge_kept

/--
info: 'IM.multiple_related_carriers_keep_implicit_plan' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.multiple_related_carriers_keep_implicit_plan

/--
info: 'IM.unqualified_carrier_keeps_implicit_plan' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.unqualified_carrier_keeps_implicit_plan

/-- info: 'IM.recorded_kinds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.recorded_kinds

/-- info: 'IM.completion_kinds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.completion_kinds

/-- info: 'IM.head_merge_kinds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_merge_kinds

/-- info: 'IM.head_f1' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_f1

/-- info: 'IM.head_f3' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_f3

/-- info: 'IM.head_f2_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_f2_refused

/--
info: 'IM.head_single_equality_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_single_equality_refused

/--
info: 'IM.head_single_equality_neighbours' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_single_equality_neighbours

/--
info: 'IM.head_f1_descending_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_f1_descending_refused

/-- info: 'IM.head_group_merges_a_and_b' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_group_merges_a_and_b

/--
info: 'IM.head_contains_any_merges' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_contains_any_merges

/-- info: 'IM.head_enterprise_base' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_enterprise_base

/--
info: 'IM.first_attempt_conflation' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.first_attempt_conflation

/--
info: 'IM.carried_array_field_with_equality_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.carried_array_field_with_equality_refused

/-- info: 'IM.head_two_carriers' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_two_carriers

/-- info: 'IM.head_group_carrier' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.head_group_carrier

/--
info: 'IM.head_b_with_automatic_contains' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_b_with_automatic_contains

/--
info: 'IM.head_b_descending_carrier' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_b_descending_carrier

/--
info: 'IM.head_b_explicit_name_carrier' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.head_b_explicit_name_carrier
