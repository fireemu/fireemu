import Std

/-!
# Write precondition rules

A document is absent or has an update time in nanoseconds. The effect of evaluating the write body records only whether it is invalid, deletes the document, or produces fields that are equal to the stored fields after normalization. That last flag matters only when a document already exists.
-/

namespace WP

abbrev State := Option Int

inductive Condition where
  | none
  | exists (wanted : Bool)
  | updateTime (time : Int)
  deriving DecidableEq, Repr

inductive Error where
  | notFound
  | alreadyExists
  | failedPrecondition
  | invalidArgument
  deriving DecidableEq, Repr

inductive Effect where
  | invalid
  | delete
  | store (sameFields : Bool)
  deriving DecidableEq, Repr

abbrev Outcome := Except Error State

def Satisfied (s : State) : Condition → Prop
  | .none => True
  | .exists wanted => s.isSome = wanted
  | .updateTime t => s = some t

inductive PreconditionRefusal : Condition → Error → Prop
  | missing : PreconditionRefusal (.exists true) .notFound
  | existing : PreconditionRefusal (.exists false) .alreadyExists
  | stale (t : Int) : PreconditionRefusal (.updateTime t) .failedPrecondition

/-- The failure of a precondition takes precedence over any error in the write body. A successful write reports the resulting document time, including the old time of a no-op, or no time for a delete. -/
inductive Rule (now : Int) (s : State) (p : Condition) : Effect → Outcome → Prop
  | precondition {effect e} : ¬ Satisfied s p → PreconditionRefusal p e →
      Rule now s p effect (.error e)
  | invalid : Satisfied s p → Rule now s p .invalid (.error .invalidArgument)
  | delete : Satisfied s p → Rule now s p .delete (.ok none)
  | preserve {t} : Satisfied s p → s = some t → Rule now s p (.store true) (.ok (some t))
  | stamp {same} : Satisfied s p → (same = false ∨ s = none) →
      Rule now s p (.store same) (.ok (some now))

end WP
