import SessionTenancy.Spec

namespace ST

theorem refusal_is_atomic (s : State) (p : Project) (message : String)
    (h : conflict s p = some message) : register s p = (some message, s) := by
  simp [register, h]

theorem acceptance_has_complete_registration (s : State) (p : Project) (h : conflict s p = none) :
    (register s p).2.registrations = p :: s.registrations := by
  simp [register, h]

theorem registered_scope_does_not_inherit_default (s : State) (p q : String)
    (h : registered s p = true) : owns s p q = (p == q) := by
  simp [owns, h]

theorem fallback_scope_is_complement (s : State) (p q : String)
    (h : registered s p = false) : owns s p q = !registered s q := by
  simp [owns, h]

theorem open_keys_are_never_refused (s : State) (k : String) (h : s.baseKeys = []) :
    refusesKey s k = false := by
  simp [refusesKey, h]

theorem recognized_suffix_takes_priority (s : State) (b p : String)
    (h : conventional b = some p) (owned : (p == s.base || registered s p) = true) :
    projectOfBucket s b = p := by
  simp [projectOfBucket, h, Option.filter, owned]

end ST
