import SchedulerRetryPolicy.Spec

namespace SRP

theorem first_attempts (c : Config) : (project .first c).attempts = 1 := rfl

theorem first_window (c : Config) : (project .first c).windowSeconds = none := rfl

theorem first_does_not_retry (c : Config) (attempt : Nat) (elapsed : Int) (h : 1 ≤ attempt) :
    allows (project .first c) attempt elapsed = false := by
  simp [allows, first_attempts, fitsWindow, first_window, Nat.not_lt.mpr h]

theorem zero_backoff_pair_defaults (c : Config) (minimum : c.minBackoff = 0) (maximum : c.maxBackoff = 0) :
    backoffPair c = (5, 3600) := by simp [backoffPair, minimum, maximum]

theorem normalized_backoff_order (c : Config) : (backoffPair c).1 ≤ (backoffPair c).2 := by
  unfold backoffPair
  split
  · omega
  · change min c.minBackoff i64Max ≤ min (max c.minBackoff c.maxBackoff) i64Max
    omega

theorem delay_capped (p : Policy) (attempt : Nat) : delay p attempt ≤ p.maximum * nanosPerSecond := by
  dsimp [delay]
  split
  · exact Nat.le_refl _
  · exact Nat.min_le_left _ _

theorem count_is_sufficient (p : Policy) (attempt : Nat) (elapsed : Int)
    (h : attempt < p.attempts) : allows p attempt elapsed = true := by simp [allows, h]

theorem exhausted_count_and_missing_window (p : Policy) (attempt : Nat) (elapsed : Int)
    (count : p.attempts ≤ attempt) (window : p.windowSeconds = none) :
    allows p attempt elapsed = false := by simp [allows, fitsWindow, window, Nat.not_lt.mpr count]

theorem exhausted_count_and_positive_window (p : Policy) (attempt limit : Nat) (elapsed : Int)
    (count : p.attempts ≤ attempt) (window : p.windowSeconds = some limit) :
    allows p attempt elapsed = true ↔
      elapsed + Int.ofNat (delay p attempt) ≤ Int.ofNat i128Max ∧
      elapsed + Int.ofNat (delay p attempt) ≤ Int.ofNat (limit * nanosPerSecond) := by
  simp [allows, fitsWindow, window, Nat.not_lt.mpr count]

theorem final_nanosecond_is_inclusive (limit maximum : Int) (fits : limit ≤ maximum) :
    (limit ≤ maximum ∧ limit ≤ limit) ∧ ¬ (limit + 1 ≤ maximum ∧ limit + 1 ≤ limit) := by
  exact ⟨⟨fits, Int.le_refl _⟩, fun h => (Int.not_le.mpr (by omega)) h.2⟩

theorem job_refuses_at_six (c : Config) :
    refusesJob c = true ↔ 6 ≤ c.count := by rw [refusesJob, decide_eq_true_eq]


end SRP
