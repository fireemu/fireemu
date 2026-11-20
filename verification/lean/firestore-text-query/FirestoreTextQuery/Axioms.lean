import FirestoreTextQuery.Theorems

/-- info: 'FirestoreTextQuery.empty_plain_has_no_hits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTextQuery.empty_plain_has_no_hits

/-- info: 'FirestoreTextQuery.one_plain_token_uses_exact_membership' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTextQuery.one_plain_token_uses_exact_membership

/-- info: 'FirestoreTextQuery.all_negative_has_no_hits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTextQuery.all_negative_has_no_hits

/-- info: 'FirestoreTextQuery.unknown_field_has_priority' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTextQuery.unknown_field_has_priority

/-- info: 'FirestoreTextQuery.page_never_exceeds_requested_limit' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTextQuery.page_never_exceeds_requested_limit

/-- info: 'FirestoreTextQuery.selection_precedes_offset' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTextQuery.selection_precedes_offset

/-- info: 'FirestoreTextQuery.split_fields_are_conjunctive_but_not_a_phrase' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in #print axioms FirestoreTextQuery.split_fields_are_conjunctive_but_not_a_phrase

/-- info: 'FirestoreTextQuery.concatenation_is_exact_and_ordered' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTextQuery.concatenation_is_exact_and_ordered

/-- info: 'FirestoreTextQuery.field_restriction_does_not_use_phrases_from_another_field' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in #print axioms FirestoreTextQuery.field_restriction_does_not_use_phrases_from_another_field
