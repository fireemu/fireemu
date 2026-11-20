import CloudTasksRetry.Spec

namespace CTRetry

theorem within_limit (limit attempt elapsed : Nat) (budget : Option Nat) (h : attempt ≤ limit) :
    exhausted limit attempt budget elapsed = false := by
  simp [exhausted, Nat.not_lt.mpr h]

theorem positive_budget_exhaustion (limit attempt budget elapsed : Nat) (h : 0 < budget) :
    exhausted limit attempt (some budget) elapsed = true ↔ limit < attempt ∧ budget < elapsed := by
  cases budget with
  | zero => omega
  | succ b => simp [exhausted]

theorem disabled_budget_equivalent (limit attempt elapsed : Nat) :
    exhausted limit attempt (some 0) elapsed = exhausted limit attempt none elapsed := rfl

theorem declared_cap (base cap doublings attempt : Nat) :
    declaredGap base cap doublings attempt ≤ cap := by
  exact Nat.min_le_left _ _

theorem production_never_shortens (gap declared : Nat) :
    declared ≤ gapMillis true gap declared := by
  exact Nat.le_max_left _ _

theorem nonproduction_unchanged (gap declared : Nat) :
    gapMillis false gap declared = declared := rfl

end CTRetry
