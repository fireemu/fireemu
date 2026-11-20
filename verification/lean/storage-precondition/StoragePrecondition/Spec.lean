import Std

namespace SP

structure ObjectId where
  generation : Nat
  metageneration : Nat
  deriving DecidableEq, Repr

/-- The live object, if any. Guard operands are unsigned; persisted identities are positive. -/
abbrev Current := Option ObjectId

inductive Guard where
  | generationMatch (value : Nat)
  | metagenerationMatch (value : Nat)
  | generationNotMatch (value : Nat)
  | metagenerationNotMatch (value : Nat)
  deriving DecidableEq, Repr

inductive Op where
  | read | metadata | upload | delete | finalize
  deriving DecidableEq, Repr

inductive Decision where
  | proceed | failed | notModified | notFound
  deriving DecidableEq, Repr

/-- A failed match or a guard that requires an object on an absent name. -/
def Fails412 : Current → Guard → Prop
  | none, .generationMatch n => n ≠ 0
  | none, _ => True
  | some o, .generationMatch n => o.generation ≠ n
  | some o, .metagenerationMatch n => o.metageneration ≠ n
  | some _, _ => False

/-- A present object with the identity excluded by a not-match guard. -/
def Fails304 : Current → Guard → Prop
  | some o, .generationNotMatch n => o.generation = n
  | some o, .metagenerationNotMatch n => o.metageneration = n
  | _, _ => False

def Passes (current : Current) (guard : Guard) : Prop :=
  ¬ Fails412 current guard ∧ ¬ Fails304 current guard

def Has412 (current : Current) (guards : List Guard) : Prop :=
  ∃ guard ∈ guards, Fails412 current guard

def Has304 (current : Current) (guards : List Guard) : Prop :=
  ∃ guard ∈ guards, Fails304 current guard

/-- Reads, metadata updates, and deletes require a target before evaluating guards.
Both forms of upload can create the object. -/
def MissingBefore (op : Op) (current : Current) : Prop :=
  op ≠ .upload ∧ op ≠ .finalize ∧ current = none

/-- The side conditions on each outcome are disjoint. In particular a 412 takes priority
over a 304, independent of where the guard is written. -/
def Verdict (op : Op) (current : Current) (guards : List Guard) : Decision → Prop
  | .proceed => ¬ MissingBefore op current ∧ ¬ Has412 current guards ∧ ¬ Has304 current guards
  | .failed => ¬ MissingBefore op current ∧ Has412 current guards
  | .notModified =>
    ¬ MissingBefore op current ∧ ¬ Has412 current guards ∧ Has304 current guards
  | .notFound => MissingBefore op current

end SP
