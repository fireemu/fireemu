import WritePrecondition.Spec

namespace WP

/-- The store compares the supplied instant directly. The clock aligns the commit stamp separately. -/
def checkPrecondition (p : Condition) (s : State) : Option Error :=
  match p, s with
  | .exists true, none => some .notFound
  | .exists false, some _ => some .alreadyExists
  | .none, _ | .exists _, _ => none
  | .updateTime t, some saved => if saved = t then none else some .failedPrecondition
  | .updateTime _, none => some .failedPrecondition

def step (now : Int) (s : State) (p : Condition) (effect : Effect) : Outcome :=
  match checkPrecondition p s with
  | some e => .error e
  | none =>
    match effect with
    | .invalid => .error .invalidArgument
    | .delete => .ok none
    | .store same =>
      if same && s.isSome then .ok s else .ok (some now)

def publishedState (s : State) : Outcome → State
  | .ok next => next
  | .error _ => s

def nextCommitTime (last : State) (now : Int) : Int :=
  let aligned := now - now % 1000
  match last with
  | some t => if aligned ≤ t then t + 1000 else aligned
  | none => aligned

/-! The corpus instantiates the write-body effect with one integer field, possibly missing. -/

structure Document where
  time : Int
  value : Option Int
  deriving DecidableEq, Repr

def documentTime (doc : Option Document) : State := doc.map (·.time)

def importClock (commitTime : Int) (doc : Option Document) : Int :=
  match doc with
  | none => commitTime
  | some doc => max commitTime (doc.time + (1000 - doc.time % 1000) % 1000)

inductive Operation where
  | replace (value : Option Int)
  | patch (value : Option Int)
  | emptyMask
  | delete (withTransform : Bool)
  | increment (delta : Option Int)
  | patchIncrement (value delta : Option Int)
  deriving DecidableEq, Repr

structure Write where
  op : Operation
  precondition : Condition
  deriving DecidableEq, Repr

def create (value : Option Int) : Write := ⟨.replace value, .exists false⟩

def increment (prior delta : Int) : Int :=
  min 9223372036854775807 (max (-9223372036854775808) (prior + delta))

def body (op : Operation) (prior : Option Int) : Effect × Option Int :=
  let store := fun value => (.store (prior == value), value)
  match op with
  | .replace value | .patch value => store value
  | .emptyMask => store prior
  | .delete false => (.delete, none)
  | .delete true | .increment none | .patchIncrement _ none => (.invalid, none)
  | .increment (some delta) => store (some (increment (prior.getD 0) delta))
  | .patchIncrement value (some delta) => store (some (increment (value.getD 0) delta))

def stage (now : Int) (doc : Option Document) (write : Write) : Except Error (Option Document) :=
  let (effect, value) := body write.op (doc.bind (·.value))
  (step now (documentTime doc) write.precondition effect).map (·.map fun t => ⟨t, value⟩)

def batch (now : Int) (doc : Option Document) :
    List Write → Except Error (Option Document × List State)
  | [] => .ok (doc, [])
  | write :: rest => do
    let next ← stage now doc write
    let (final, times) ← batch now next rest
    pure (final, documentTime next :: times)

def publishedDocument (doc : Option Document) :
    Except Error (Option Document × List State) → Option Document
  | .ok (final, _) => final
  | .error _ => doc

end WP
