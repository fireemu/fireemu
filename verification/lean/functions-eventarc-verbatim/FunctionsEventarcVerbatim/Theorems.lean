import FunctionsEventarcVerbatim.Spec

namespace Verbatim

theorem admission_iff_alert (value : Scalar) :
    admittedType value = some "alert" ↔ value = .text := by
  cases value <;> decide

theorem empty_type_is_routable_but_refused_at_the_boundary :
    eventType .empty = some "" ∧ admittedType .empty = none := by decide

theorem truthy_nonstrings_are_not_deliverable
    (value : Scalar) (truthy : outerAllows value = true) (nonstr : value ≠ .text) :
    eventType value = none := by
  cases value <;> simp_all [outerAllows, eventType]

theorem string_member_shadows (top : Scalar) (nested : Nested) (text : String)
    (present : topText top = some text) : filterAttribute top nested = some text := by
  simp [filterAttribute, present]

theorem nonstring_member_falls_back (top : Scalar) (nested : Nested)
    (absent : topText top = none) : filterAttribute top nested = nestedText nested := by
  simp [filterAttribute, absent]

end Verbatim
