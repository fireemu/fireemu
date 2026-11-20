import Std

namespace AN

structure State where
  seen : List Nat := []
  suppressed : Bool := false
  deriving DecidableEq

inductive Emitted where
  | silent
  | first
  | stop
  deriving DecidableEq

def observe (cap : Nat) (seen : State) (name : Nat) : State × Emitted :=
  if seen.seen.contains name then (seen, .silent)
  else if seen.seen.length < cap then ({ seen with seen := name :: seen.seen }, .first)
  else if seen.suppressed then (seen, .silent)
  else ({ seen with suppressed := true }, .stop)

def replay (cap : Nat) (state : State) : List Nat → List Emitted
  | [] => []
  | name :: tail =>
    let (next, emitted) := observe cap state name
    emitted :: replay cap next tail

end AN
