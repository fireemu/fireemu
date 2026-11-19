import IndexMerge.Counterexamples
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
info: 'IM.merge_composite_with_array_field' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.merge_composite_with_array_field

/--
info: 'IM.composite_with_array_field_descending_name_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.composite_with_array_field_descending_name_refused

/--
info: 'IM.opposite_direction_automatic_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.opposite_direction_automatic_refused

/--
info: 'IM.merge_contains_with_descending_name' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.merge_contains_with_descending_name

/--
info: 'IM.broad_mirror_direction_automatic' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.broad_mirror_direction_automatic

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

/-- info: 'IM.phase_sound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.phase_sound

/-- info: 'IM.phase_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.phase_iff

/-- info: 'IM.member_recorded' depends on axioms: [propext] -/
#guard_msgs in #print axioms IM.member_recorded

/-- info: 'IM.member_fields' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.member_fields

/-- info: 'IM.merged_kinds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms IM.merged_kinds

/--
info: 'IM.composite_with_array_field_group_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.composite_with_array_field_group_refused

/--
info: 'IM.contains_descending_name_group_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.contains_descending_name_group_refused

/--
info: 'IM.contains_any_descending_name_refused' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.contains_any_descending_name_refused

/--
info: 'IM.array_member_never_covers_equality' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.array_member_never_covers_equality

/--
info: 'IM.carried_array_field_never_covers_equality' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.carried_array_field_never_covers_equality

/--
info: 'IM.single_equality_neighbours_served' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms IM.single_equality_neighbours_served
