import PubsubSnapshotLifetime.Theorems

/-- info: 'SnapshotLifetime.empty_has_full_lifetime' does not depend on any axioms -/
#guard_msgs in #print axioms SnapshotLifetime.empty_has_full_lifetime

/-- info: 'SnapshotLifetime.future_has_full_lifetime' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SnapshotLifetime.future_has_full_lifetime

/-- info: 'SnapshotLifetime.threshold_is_inclusive' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SnapshotLifetime.threshold_is_inclusive

/-- info: 'SnapshotLifetime.rejects_iff_older' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms SnapshotLifetime.rejects_iff_older

/-- info: 'SnapshotLifetime.minimum_duration_equivalent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SnapshotLifetime.minimum_duration_equivalent

/-- info: 'SnapshotLifetime.exact_expiry_is_invisible' depends on axioms: [propext] -/
#guard_msgs in #print axioms SnapshotLifetime.exact_expiry_is_invisible

/-- info: 'SnapshotLifetime.visibility_before' depends on axioms: [propext] -/
#guard_msgs in #print axioms SnapshotLifetime.visibility_before
