import FirestoreTransforms.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'FirestoreTransforms.increment_in_bounds' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTransforms.increment_in_bounds

/-- info: 'FirestoreTransforms.increment_exact_when_representable' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTransforms.increment_exact_when_representable

/-- info: 'FirestoreTransforms.increment_clamps_upper' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTransforms.increment_clamps_upper

/-- info: 'FirestoreTransforms.increment_clamps_lower' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTransforms.increment_clamps_lower

/-- info: 'FirestoreTransforms.numeric_tie_preserves_current' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTransforms.numeric_tie_preserves_current

/-- info: 'FirestoreTransforms.timestamp_truncation_preserves_canonical_key' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTransforms.timestamp_truncation_preserves_canonical_key

/-- info: 'FirestoreTransforms.union_keeps_prefix' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTransforms.union_keeps_prefix

/-- info: 'FirestoreTransforms.removal_contains_exactly_unmatched' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTransforms.removal_contains_exactly_unmatched
