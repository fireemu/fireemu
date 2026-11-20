import AuthPhoneNormalization.Spec

namespace AuthPhoneNormalization

theorem successful_normalization_validates (phone output : List Char)
    (h : normalize phone = some output) : validate output = true := by
  unfold normalize at h
  split at h
  · rename_i suffix
    cases hh : collect suffix with
    | none => simp [hh] at h
    | some digits =>
      simp only [hh] at h
      split at h
      · rename_i ok
        cases h
        exact (Bool.and_eq_true_iff.mp ok).2
      · contradiction
  · contradiction

theorem separators_are_erased (c : Char) (suffix : List Char) (h : separator c = true) :
    collect (c :: suffix) = collect suffix := by
  simp [collect, h]

theorem formatted_zero_has_stricter_admission :
    normalize ['+', '0', ' ', '1', '2', '3', '4', '5', '6'] = none ∧ validate ['+', '0', '1', '2', '3', '4', '5', '6'] = true := by decide

theorem vanity_letters_map_case_insensitively :
    normalize ['+', '1', '-', '8', '0', '0', '-', 'F', 'L', 'o', 'W', 'E', 'r', 'S'] = some ['+', '1', '8', '0', '0', '3', '5', '6', '9', '3', '7', '7'] := by decide

end AuthPhoneNormalization
