import Std

namespace SessionFault

structure Call where
  operation : String
  function : Option String
  event : Option String
  deriving DecidableEq, Repr

structure Rule where
  operation : String
  function : Option String
  event : Option String
  nth : Option Nat
  action : Nat
  deriving DecidableEq, Repr

def relevantCount (rule : Rule) (prior : List Call) : Nat :=
  prior.countP (fun call =>
    call.operation == rule.operation && rule.function.all (some · == call.function)) + 1

/-- Count all calls to the operation (or function), even when the event type did not match. -/
def fires (call : Call) (prior : List Call) (rule : Rule) : Bool :=
  rule.operation == call.operation &&
    rule.function.all (some · == call.function) &&
    rule.event.all (some · == call.event) &&
    rule.nth.all (· == relevantCount rule prior)

def select (rules : List Rule) (prior : List Call) (call : Call) : List Nat :=
  (rules.filter (fires call prior)).map Rule.action

structure Fired where
  operation : String
  function : Option String
  occurrence : Nat
  functionOccurrence : Option Nat
  action : Nat
  deriving DecidableEq, Repr

def occurrence (c : Call) (prior : List Call) : Nat :=
  prior.countP (fun p => p.operation == c.operation) + 1

def functionOccurrence (c : Call) (prior : List Call) : Option Nat :=
  c.function.map (fun f =>
    prior.countP (fun p => p.operation == c.operation && p.function == some f) + 1)

/-- History is a suffix of the full sequence, oldest retained first. -/
def retained {α : Type} (cap : Nat) (xs : List α) : List α :=
  xs.drop (xs.length - cap)

def fired (rules : Option (List Rule)) (calls : List Call) : List Fired :=
  match rules with
  | none => []
  | some plan =>
    let rec walk (seen : List Call) : List Call → List Fired
      | [] => []
      | call :: rest =>
        let records := (select plan seen call).map fun action =>
          ⟨call.operation, call.function, occurrence call seen, functionOccurrence call seen, action⟩
        records ++ walk (call :: seen) rest
    walk [] calls

end SessionFault
