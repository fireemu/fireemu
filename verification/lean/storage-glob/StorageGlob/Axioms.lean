import StorageGlob.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'StorageGlob.literal_is_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageGlob.literal_is_exact

/-- info: 'StorageGlob.question_cannot_match_slash' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageGlob.question_cannot_match_slash

/-- info: 'StorageGlob.range_cannot_match_slash' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageGlob.range_cannot_match_slash

/-- info: 'StorageGlob.segment_cannot_consume_any_slash' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageGlob.segment_cannot_consume_any_slash

/-- info: 'StorageGlob.directory_star_can_skip' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageGlob.directory_star_can_skip

/-- info: 'StorageGlob.directory_star_requires_slash' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageGlob.directory_star_requires_slash

/-- info: 'StorageGlob.recursive_star_generalizes_segment' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageGlob.recursive_star_generalizes_segment

/-- info: 'StorageGlob.alternatives_distribute' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageGlob.alternatives_distribute

/-- info: 'StorageGlob.scalar_not_utf8_byte' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageGlob.scalar_not_utf8_byte

/-- info: 'StorageGlob.two_scalars_do_not_match_one' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageGlob.two_scalars_do_not_match_one
