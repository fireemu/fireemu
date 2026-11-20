import Std

namespace RulesFailureAlgebra

inductive Operand where
  | yes | no | missing | fault | unsupported
  deriving DecidableEq

inductive Outcome where
  | returned (value : Bool)
  | deferred
  | refused
  deriving DecidableEq

structure Observation where
  outcome : Outcome
  readMissing : Bool
  deriving DecidableEq

def defer (stop : Bool) (tail : Observation) : Observation :=
  if tail.outcome = .returned !stop then { tail with outcome := .deferred } else tail

/-- The boolean that can decide a chain is false for conjunction and true for disjunction.
Recoverable failures only decide if the remainder contains no absorbing boolean or refusal. -/
def observe (stop : Bool) : List Operand → Observation
  | [] => ⟨.returned !stop, false⟩
  | .yes :: tail => if stop then ⟨.returned true, false⟩ else observe stop tail
  | .no :: tail => if stop then observe stop tail else ⟨.returned false, false⟩
  | .unsupported :: _ => ⟨.refused, false⟩
  | .missing :: tail => { defer stop (observe stop tail) with readMissing := true }
  | .fault :: tail => defer stop (observe stop tail)

def absorbing (stop : Bool) : Operand := if stop then .yes else .no

theorem absorber_ignores_suffix (stop : Bool) (tail : List Operand) :
    observe stop (absorbing stop :: tail) = ⟨.returned stop, false⟩ := by
  cases stop <;> rfl

theorem missing_is_absorbed_but_observed (stop : Bool) (tail : List Operand) :
    observe stop (.missing :: absorbing stop :: tail) = ⟨.returned stop, true⟩ := by
  cases stop <;> rfl

theorem unsupported_precedes_later_absorber (stop : Bool) (tail : List Operand) :
    observe stop (.unsupported :: absorbing stop :: tail) = ⟨.refused, false⟩ := rfl

theorem neutral_only (stop : Bool) (n : Nat) :
    observe stop (List.replicate n (absorbing !stop)) = ⟨.returned !stop, false⟩ := by
  induction n with
  | zero => rfl
  | succ n ih =>
    cases stop <;> simpa [absorbing, observe, List.replicate_succ] using ih

theorem recoverable_prefix (stop : Bool) (failures : List Operand) (tail : List Operand)
    (h : ∀ x ∈ failures, x = .fault ∨ x = .missing) :
    (observe stop (failures ++ absorbing stop :: tail)).outcome = .returned stop := by
  induction failures with
  | nil => exact congrArg Observation.outcome (absorber_ignores_suffix stop tail)
  | cons x xs ih =>
    have xt := h x (by simp)
    have rest := ih (fun y hy => h y (by simp [hy]))
    rcases xt with rfl | rfl <;>
      cases stop <;> simp [observe, defer, rest]

end RulesFailureAlgebra
