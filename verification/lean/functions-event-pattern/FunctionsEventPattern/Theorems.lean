import FunctionsEventPattern.Spec

namespace FunctionsEventPattern

/-! The single-component and remainder rules below are semantic equations, independent of parsing. -/

theorem terminal_multi_capture (name : String) (parts : List String) :
    matchParts [.multiCapture name] parts = some [(name, String.intercalate "/" parts)] := by
  rfl

theorem literal_consumes_one (literal : String) (pat : List Segment) (parts : List String) :
    matchParts (.literal literal :: pat) (literal :: parts) = matchParts pat parts := by
  simp [matchParts]

theorem accepted_fixed_pattern_length {pat : List Segment} {parts : List String}
    {params : List (String × String)}
    (fixed : ∀ seg ∈ pat, isMulti seg = false)
    (accepted : matchParts pat parts = some params) :
    pat.length = parts.length := by
  induction pat generalizing parts params with
  | nil => cases parts <;> simp_all [matchParts]
  | cons seg pat ih =>
    have head := fixed seg (by simp)
    have rest (s : Segment) (h : s ∈ pat) := fixed s (by simp [h])
    cases seg <;> cases parts <;> simp_all [isMulti, matchParts]
    · exact ih accepted.2
    · exact ih accepted
    · obtain ⟨_, acceptedTail, _⟩ := accepted
      exact ih acceptedTail

end FunctionsEventPattern
