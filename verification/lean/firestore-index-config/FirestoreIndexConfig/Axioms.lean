import FirestoreIndexConfig.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'FirestoreIndexConfig.too_many_fields_have_priority' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreIndexConfig.too_many_fields_have_priority

/-- info: 'FirestoreIndexConfig.normalized_valid_shape_accepted' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreIndexConfig.normalized_valid_shape_accepted

/-- info: 'FirestoreIndexConfig.necessary_check_independent_of_scope' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreIndexConfig.necessary_check_independent_of_scope

/-- info: 'FirestoreIndexConfig.single_document_field_remains_necessary' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreIndexConfig.single_document_field_remains_necessary

/-- info: 'FirestoreIndexConfig.single_vector_field_remains_necessary' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreIndexConfig.single_vector_field_remains_necessary
