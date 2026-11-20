import FirestorePartitionQuery.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'FirestorePartitionQuery.same_relative_path_hash' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestorePartitionQuery.same_relative_path_hash

/-- info: 'FirestorePartitionQuery.sampled_is_namespace_independent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestorePartitionQuery.sampled_is_namespace_independent

/-- info: 'FirestorePartitionQuery.cursor_count' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestorePartitionQuery.cursor_count

/-- info: 'FirestorePartitionQuery.cursor_membership_nests' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestorePartitionQuery.cursor_membership_nests

/-- info: 'FirestorePartitionQuery.every_cursor_was_sampled' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestorePartitionQuery.every_cursor_was_sampled

/-- info: 'FirestorePartitionQuery.hashRelativeAgrees' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestorePartitionQuery.hashRelativeAgrees

/-- info: 'FirestorePartitionQuery.streamingKeyHashAgrees' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestorePartitionQuery.streamingKeyHashAgrees

/-- info: 'FirestorePartitionQuery.mapAfterPagination' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestorePartitionQuery.mapAfterPagination
