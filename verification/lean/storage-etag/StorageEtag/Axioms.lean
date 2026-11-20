import StorageEtag.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'StorageEtag.varint_digits_bounded_size' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.varint_digits_bounded_size

/-- info: 'StorageEtag.varint_digits_read' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.varint_digits_read

/-- info: 'StorageEtag.varint_read' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.varint_read

/-- info: 'StorageEtag.varint_injective_for_u64' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.varint_injective_for_u64

/-- info: 'StorageEtag.base64_emits_full_quartets' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.base64_emits_full_quartets

/-- info: 'StorageEtag.bucket_tags_and_payload' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.bucket_tags_and_payload

/-- info: 'StorageEtag.object_tags_and_payload' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.object_tags_and_payload

/-- info: 'StorageEtag.object_metageneration_payload' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.object_metageneration_payload

/-- info: 'StorageEtag.recorded_object_vector' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.recorded_object_vector

/-- info: 'StorageEtag.recorded_bucket_vector' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageEtag.recorded_bucket_vector
