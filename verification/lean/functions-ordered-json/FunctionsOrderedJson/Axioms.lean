import FunctionsOrderedJson.Theorems

/-! Build-time proof dependency guards. -/

/-- info: 'FOJ.first_ignores_later_same_key' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FOJ.first_ignores_later_same_key

/-- info: 'FOJ.last_prefers_appended_key' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FOJ.last_prefers_appended_key

/-- info: 'FOJ.duplicates_choose_opposite_ends' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FOJ.duplicates_choose_opposite_ends

/-- info: 'FOJ.empty_object_has_no_internal_whitespace' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FOJ.empty_object_has_no_internal_whitespace

/-- info: 'FOJ.append_member_preserves_printed_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FOJ.append_member_preserves_printed_order
