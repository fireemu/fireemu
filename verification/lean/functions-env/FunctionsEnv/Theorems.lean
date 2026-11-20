import FunctionsEnv.Spec

namespace FunctionsEnv

theorem exact_runtime_key_rejected {key : String}
    (reserved : reservedKeys.contains key = true) :
    validate key = .error .exact := by
  unfold validate
  rw [ite_eq_left reserved]

theorem invalid_shape_precedes_prefix {key : String}
    (ordinary : reservedKeys.contains key = false) (shape : shaped key = false) :
    validate key = .error .shape := by
  unfold validate
  have free : ¬reservedKeys.contains key = true := by rw [ordinary]; decide
  rw [ite_eq_right free, ite_eq_left (by rw [shape]; decide)]

theorem accepted_key_has_valid_shape {key : String}
    (accepted : validate key = .ok ()) :
    shaped key = true := by
  by_cases shape : shaped key = true
  · exact shape
  · have bad : shaped key = false := Bool.of_not_eq_true shape
    by_cases reserved : reservedKeys.contains key = true
    · rw [exact_runtime_key_rejected reserved] at accepted
      contradiction
    · have ordinary : reservedKeys.contains key = false :=
        Bool.of_not_eq_true reserved
      rw [invalid_shape_precedes_prefix ordinary bad] at accepted
      contradiction

theorem local_file_last (project : String) (alias : Option String) :
    (fileOrder project alias).getLast? = some ".env.local" := by
  cases alias <;> rfl

end FunctionsEnv

namespace FunctionsEnv

theorem appended_assignment_wins (key body : String) (earlier : List (String × String)) :
    readAssignment key (earlier ++ [(key, body)]) = some body := by
  simp [readAssignment]

theorem single_quote_preserves_body (body : String) : value .single body = body := by
  rfl

end FunctionsEnv
