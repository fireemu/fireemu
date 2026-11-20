import AppCheckAdmission.Spec

namespace AppCheckAdmission

theorem classify_empty : classify [] = .missing := rfl

theorem duplicates_refused (first second : String) (remaining : List String) :
    classify (first :: second :: remaining) = .malformed := rfl

theorem classified_value_iff (fields : List String) (value : String) :
    classify fields = .present value ↔ fields = [value] ∧ eligible value = true := by
  cases fields with
  | nil => simp [classify]
  | cons first remaining =>
    cases remaining with
    | nil =>
      cases accepted : eligible first <;> simp [classify, accepted] <;>
        intro same <;> rwa [← same]
    | cons second remaining => simp [classify]

theorem over_limit_refused (value : String) (h : 16384 < value.utf8ByteSize) :
    classify [value] = .malformed := by
  simp [classify, eligible, Nat.not_le_of_lt h]

theorem normalized_version_four (text canonical : String) :
    normalize text = some canonical ↔ uuidV4 text = true ∧ canonical = text.toLower := by
  by_cases valid : uuidV4 text <;> simp [normalize, valid, eq_comm]

theorem collected_values_preserve_order (first last : List (String × String)) :
    collect (first ++ last) = collect first ++ collect last := by
  simp [collect, List.filter_append, List.map_append]

end AppCheckAdmission
