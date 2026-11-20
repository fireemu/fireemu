import PythonRunnerDuplicateMembers.Theorems

/-- info: 'PyDuplicate.lookup_upsert' depends on axioms: [propext] -/
#guard_msgs in #print axioms PyDuplicate.lookup_upsert

/-- info: 'PyDuplicate.other_lookup_unchanged' depends on axioms: [propext] -/
#guard_msgs in #print axioms PyDuplicate.other_lookup_unchanged

/-- info: 'PyDuplicate.key_order_upsert' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyDuplicate.key_order_upsert

/-- info: 'PyDuplicate.decoded_duplicate_keeps_first_position' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PyDuplicate.decoded_duplicate_keeps_first_position

/-- info: 'PyDuplicate.decoded_duplicate_uses_last_lexeme' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms PyDuplicate.decoded_duplicate_uses_last_lexeme
