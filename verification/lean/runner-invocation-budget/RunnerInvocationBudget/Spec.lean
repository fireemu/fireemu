import Std

namespace RunnerInvocationBudget

inductive Reason where
  | closed | invalid | duplicate | count | bytes
  deriving Repr, DecidableEq

def Reason.text : Reason → String
  | .closed => "closed"
  | .invalid => "invocation accounting"
  | .duplicate => "duplicate active invocation"
  | .count => "active invocation count"
  | .bytes => "active invocation bytes"

structure Cap where
  count : Nat
  bytes : Nat
  deriving Repr

structure Lease where
  id : String
  payload : Nat
  token : Nat
  deriving Repr, DecidableEq

structure State where
  active : List Lease := []
  next : Nat := 0
  failed : Bool := false
  deriving Repr, DecidableEq

def State.bytes (state : State) : Nat :=
  (state.active.map Lease.payload).sum

def maxFrame : Nat := 16777216

def refusal (cap : Cap) (state : State) (id : String) (payload : Nat) : Option Reason :=
  if state.failed then some .closed
  else if id.isEmpty || payload == 0 || payload > maxFrame then some .invalid
  else if state.active.any (fun lease => lease.id == id) then some .duplicate
  else if state.active.length ≥ cap.count then some .count
  else if state.bytes + payload > cap.bytes then some .bytes
  else none

def reserve (cap : Cap) (state : State) (id : String) (payload : Nat) :
    State × Except Reason Nat :=
  match refusal cap state id payload with
  | some reason => ({ state with failed := true }, .error reason)
  | none =>
    ({ state with active := ⟨id, payload, state.next⟩ :: state.active, next := state.next + 1 },
     .ok state.next)

/-- Releases select by lease identity. The visible ID can be reused after release. -/
def release (state : State) (token : Nat) : State :=
  { state with active := state.active.filter (fun lease => lease.token != token) }

end RunnerInvocationBudget
