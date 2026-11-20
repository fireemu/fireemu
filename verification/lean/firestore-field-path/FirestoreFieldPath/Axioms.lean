import FirestoreFieldPath.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'FirestoreFieldPath.quoted_content_recovers' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreFieldPath.quoted_content_recovers

/-- info: 'FirestoreFieldPath.one_segment_bytes' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreFieldPath.one_segment_bytes

/-- info: 'FirestoreFieldPath.append_segment_bytes' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreFieldPath.append_segment_bytes

/-- info: 'FirestoreFieldPath.validated_path_fits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreFieldPath.validated_path_fits
