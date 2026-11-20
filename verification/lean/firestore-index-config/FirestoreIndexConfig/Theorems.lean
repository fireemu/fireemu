import FirestoreIndexConfig.Spec

namespace FirestoreIndexConfig

theorem too_many_fields_have_priority (profile : Profile) (entry : Entry)
    (over : 100 < entry.fields.length) : check profile entry = .error .tooMany := by
  simp [check, over]

theorem normalized_valid_shape_accepted (profile : Profile) (entry : Entry)
    (length : entry.fields.length ≤ 100) (arrays : arrayCount entry ≤ 1)
    (composite : 2 ≤ entry.fields.length) : check profile entry = .ok () := by
  have fieldLimit := Nat.not_lt_of_ge length
  have arrayLimit := Nat.not_lt_of_ge arrays
  simp [check, fieldLimit, arrayLimit, Nat.not_lt_of_ge composite]

theorem necessary_check_independent_of_scope (profile : Profile) (first second : Scope)
    (fields : List Kind) : check profile ⟨first, fields⟩ = check profile ⟨second, fields⟩ := by
  rfl

theorem single_document_field_remains_necessary (scope : Scope) :
    check .deploy ⟨scope, [.documentName]⟩ = .ok () := by
  rfl

theorem single_vector_field_remains_necessary (scope : Scope) :
    check .deploy ⟨scope, [.vector]⟩ = .ok () := by
  rfl

end FirestoreIndexConfig
