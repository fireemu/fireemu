import LimitEvaluation.Spec

namespace LimitEvaluation

theorem ratio_saturates (current maximum : Nat) : ratioMicros current maximum ≤ maxMicros := by
  unfold ratioMicros
  split
  · split
    · exact Nat.zero_le _
    · exact Nat.le_refl _
  · exact Nat.min_le_left _ _

theorem threshold_monotone (a c maximum bp : Nat) (hac : a ≤ c)
    (h : reaches a maximum bp = true) : reaches c maximum bp = true := by
  by_cases hz : maximum = 0
  · subst maximum
    simp [reaches] at h ⊢
    omega
  · simp [reaches, hz] at h ⊢
    exact Nat.le_trans h (Nat.mul_le_mul_right 10_000 hac)

theorem no_maximum_allows (b : Boundary) (observe : Bool) (c : Nat) :
    evaluate b observe none c = .allow := rfl

theorem observed_violation_does_not_reject (b : Boundary) (c max : Nat)
    (h : violates b c max = true) : evaluate b true (some max) c = .observe := by
  simp [evaluate, h]

theorem violation_precedes_warning (b : Boundary) (c max : Nat)
    (h : violates b c max = true) : evaluate b false (some max) c = .reject := by
  simp [evaluate, h]

theorem exclusive_maximum_rejects_at_equality (max : Nat) :
    evaluate .exclusive false (some max) max = .reject := by
  simp [evaluate, violates]

theorem zero_has_no_approach_zone : evaluate .inclusive false (some 0) 0 = .allow := by
  decide

theorem truncating_is_never_refusal (c max : Nat) :
    evaluate .truncating false (some max) c ≠ .reject := by
  simp [evaluate, violates]
  split <;> intro h <;> contradiction

theorem matching_override_wins (p : Profile) (n : Nat)
    (h : p.overrideApplies = true) (grant : p.supportOverride = some n) :
    p.effective = some n := by
  simp [Profile.effective, h, grant]

end LimitEvaluation
