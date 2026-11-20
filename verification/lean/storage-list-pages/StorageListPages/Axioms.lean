import StorageListPages.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'StorageListPages.unique_has_no_duplicates' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageListPages.unique_has_no_duplicates

/-- info: 'StorageListPages.ordered_has_no_duplicate_keys' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageListPages.ordered_has_no_duplicate_keys

/-- info: 'StorageListPages.cut_is_partition' does not depend on any axioms -/
#guard_msgs in #print axioms StorageListPages.cut_is_partition

/-- info: 'StorageListPages.pages_have_no_loss' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageListPages.pages_have_no_loss

/-- info: 'StorageListPages.stable_pages_have_no_duplicate_keys' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageListPages.stable_pages_have_no_duplicate_keys

/-- info: 'StorageListPages.marker_preserves_remaining' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageListPages.marker_preserves_remaining

/-- info: 'StorageListPages.firebase_marker_uses_last_returned' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageListPages.firebase_marker_uses_last_returned

/-- info: 'StorageListPages.gcs_marker_uses_first_remaining' depends on axioms: [propext] -/
#guard_msgs in #print axioms StorageListPages.gcs_marker_uses_first_remaining
