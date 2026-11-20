import PubsubSnapshotSeek.Theorems

/-- info: 'SnapshotSeek.captured_ack_stays_acknowledged' depends on axioms: [propext] -/
#guard_msgs in #print axioms SnapshotSeek.captured_ack_stays_acknowledged

/-- info: 'SnapshotSeek.pending_capture_is_replayed' depends on axioms: [propext] -/
#guard_msgs in #print axioms SnapshotSeek.pending_capture_is_replayed

/-- info: 'SnapshotSeek.same_time_uncaptured_is_replayed' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SnapshotSeek.same_time_uncaptured_is_replayed

/-- info: 'SnapshotSeek.earlier_uncaptured_is_not_replayed' depends on axioms: [propext] -/
#guard_msgs in #print axioms SnapshotSeek.earlier_uncaptured_is_not_replayed

/-- info: 'SnapshotSeek.insertion_starts_before_first_new' depends on axioms: [propext] -/
#guard_msgs in #print axioms SnapshotSeek.insertion_starts_before_first_new

/-- info: 'SnapshotSeek.no_additions_preserve_the_target' depends on axioms: [propext] -/
#guard_msgs in #print axioms SnapshotSeek.no_additions_preserve_the_target
