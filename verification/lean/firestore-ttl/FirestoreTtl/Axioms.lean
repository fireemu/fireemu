import FirestoreTtl.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'FirestoreTtl.admit_seconds_exact' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreTtl.admit_seconds_exact

/-- info: 'FirestoreTtl.parsed_seconds_within_limit' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTtl.parsed_seconds_within_limit

/-- info: 'FirestoreTtl.expired_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTtl.expired_iff

/-- info: 'FirestoreTtl.missing_keeps_document' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreTtl.missing_keeps_document

/-- info: 'FirestoreTtl.omitted_offset_zero' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreTtl.omitted_offset_zero

/-- info: 'FirestoreTtl.expiry_is_strict' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTtl.expiry_is_strict

/-- info: 'FirestoreTtl.expiry_monotone_in_now' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTtl.expiry_monotone_in_now

/-- info: 'FirestoreTtl.greater_offset_delays_expiry' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTtl.greater_offset_delays_expiry

/-- info: 'FirestoreTtl.clock_inside_timestamp_range' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreTtl.clock_inside_timestamp_range

/-- info: 'FirestoreTtl.clock_unchanged_inside_range' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreTtl.clock_unchanged_inside_range
