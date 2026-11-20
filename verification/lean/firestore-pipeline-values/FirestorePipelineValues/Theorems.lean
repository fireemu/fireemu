import FirestorePipelineValues.Spec

namespace FirestorePipelineValues

theorem equality_is_key_equivalence (a b : Operand) :
    compareBy .eq a b = equivalent a b := by
  unfold compareBy order equivalent
  by_cases h : key a = key b
  · simp [h]
  · by_cases domains : (key a).1 = (key b).1
    · simp [domains, h]
      split <;> decide
    · simp [domains, h]

theorem inequality_is_complement (a b : Operand) :
    compareBy .ne a b = !(compareBy .eq a b) := by
  rfl

theorem equality_is_symmetric (a b : Operand) :
    compareBy .eq a b = compareBy .eq b a := by
  rw [equality_is_key_equivalence a b, equality_is_key_equivalence b a]
  unfold equivalent
  simp [eq_comm]

theorem equality_is_transitive {a b c : Operand}
    (ab : compareBy .eq a b = true) (bc : compareBy .eq b c = true) :
    compareBy .eq a c = true := by
  simp only [equality_is_key_equivalence, equivalent, decide_eq_true_eq] at *
  exact ab.trans bc

theorem same_integer_and_double (n : Int) :
    compareBy .eq (.integer n) (.doubleHalf (n * 2)) = true := by
  simp [equality_is_key_equivalence, equivalent, key]

theorem missing_compares_equal_to_itself :
    compareBy .eq .missing .missing = true := by decide

theorem missing_and_null_are_incomparable :
    order .missing .null = none := by decide

theorem missing_never_matches_membership (values : List Operand) :
    contains .missing values = false := by simp [contains]

theorem explicit_null_matches_a_null_element (values : List Operand) :
    contains .null (.null :: values) = true := by simp [contains, equivalent]

theorem numeric_membership_matches_an_equal_double (n : Int) (values : List Operand) :
    contains (.integer n) (.doubleHalf (n * 2) :: values) = true := by
  simp [contains, equivalent, key]

theorem nan_and_infinities_are_incomparable :
    order .nan .negInf = none ∧ order .nan .posInf = none := by decide

end FirestorePipelineValues
