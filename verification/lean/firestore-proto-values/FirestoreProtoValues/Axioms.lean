import FirestoreProtoValues.Theorems

/-- info: 'FirestoreProtoValues.valid_timestamp_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreProtoValues.valid_timestamp_iff

/-- info: 'FirestoreProtoValues.negative_nanos_precede_seconds_range' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreProtoValues.negative_nanos_precede_seconds_range

/-- info: 'FirestoreProtoValues.nonfinite_latitude_is_invalid' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreProtoValues.nonfinite_latitude_is_invalid

/-- info: 'FirestoreProtoValues.container_boundary' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreProtoValues.container_boundary

/-- info: 'FirestoreProtoValues.map_marker_must_be_exact' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreProtoValues.map_marker_must_be_exact

/-- info: 'FirestoreProtoValues.vector_has_no_additional_fields' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreProtoValues.vector_has_no_additional_fields

/-- info: 'FirestoreProtoValues.vector_rejects_nonnumeric_member' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreProtoValues.vector_rejects_nonnumeric_member

/-- info: 'FirestoreProtoValues.reserved_name_is_reported_before_type' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreProtoValues.reserved_name_is_reported_before_type

/-- info: 'FirestoreProtoValues.recognize_empty_vector' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreProtoValues.recognize_empty_vector

/-- info: 'FirestoreProtoValues.missing_marker_decodes_an_ordinary_map' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreProtoValues.missing_marker_decodes_an_ordinary_map
