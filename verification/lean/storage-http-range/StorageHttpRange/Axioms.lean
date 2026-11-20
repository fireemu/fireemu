import StorageHttpRange.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'StorageHttpRange.clipped_interval_bounds' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageHttpRange.clipped_interval_bounds

/-- info: 'StorageHttpRange.positive_suffix_has_nonempty_interval' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageHttpRange.positive_suffix_has_nonempty_interval

/-- info: 'StorageHttpRange.unsatisfied_range_falls_back_in_emulator' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageHttpRange.unsatisfied_range_falls_back_in_emulator

/-- info: 'StorageHttpRange.terminal_upload_recovers_via_status' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageHttpRange.terminal_upload_recovers_via_status

/-- info: 'StorageHttpRange.retry_does_not_double_append' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageHttpRange.retry_does_not_double_append

/-- info: 'StorageHttpRange.contiguous_chunk_is_appended' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageHttpRange.contiguous_chunk_is_appended

/-- info: 'StorageHttpRange.closed_u64_end_has_no_successor' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageHttpRange.closed_u64_end_has_no_successor
