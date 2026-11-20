import EventRetry.Spec

namespace EventRetry

theorem backoff_le_cap (p : Policy) (n : Nat) : p.backoff n ≤ p.cap := by
  unfold Policy.backoff
  dsimp only
  split
  · exact Int.le_refl _
  · exact Int.min_le_left _ _

theorem first_backoff (p : Policy) (h : p.base ≤ p.cap) : p.backoff 1 = p.base := by
  simp [Policy.backoff, Int.min_eq_right h]

theorem attempts_override_age (p : Policy) (n : Nat) (elapsed : Int)
    (h : n < p.attempts) : p.byAge n elapsed = true := by
  simp [Policy.byAge, Policy.byAttempts, h]

theorem no_window_uses_attempts (p : Policy) (n : Nat) (elapsed : Int)
    (h : p.window = none) : p.byAge n elapsed = p.byAttempts n := by
  simp [Policy.byAge, h]

theorem last_age_inclusive (p : Policy) (n : Nat) (elapsed : Int)
    (h : p.window = some (elapsed + p.backoff n))
    (lo : minInt ≤ elapsed + p.backoff n) (hi : elapsed + p.backoff n ≤ maxInt) :
    p.byAge n elapsed = true := by
  simp [Policy.byAge, h, lo, hi]

theorem exhausted_and_too_late (p : Policy) (n : Nat) (elapsed maxAge : Int)
    (hn : p.attempts ≤ n) (hw : p.window = some maxAge)
    (hl : maxAge < elapsed + p.backoff n) : p.byAge n elapsed = false := by
  simp [Policy.byAge, Policy.byAttempts, Nat.not_lt.mpr hn, hw, Int.not_le.mpr hl]

theorem exhausted_with_overflow (p : Policy) (n : Nat) (elapsed : Int)
    (hn : p.attempts ≤ n) (ho : maxInt < elapsed + p.backoff n) :
    p.byAge n elapsed = false := by
  cases hw : p.window <;>
    simp [Policy.byAge, Policy.byAttempts, Nat.not_lt.mpr hn, hw, Int.not_le.mpr ho]

theorem doubling_cutoff_is_observable :
    ({ attempts := 200, base := 0, cap := 42 } : Policy).backoff 120 = 0 ∧
    ({ attempts := 200, base := 0, cap := 42 } : Policy).backoff 121 = 42 := by decide

end EventRetry
