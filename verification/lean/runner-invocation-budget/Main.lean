import RunnerInvocationBudget

open RunnerInvocationBudget

inductive Operation where
  | reserve (label id : String) (payload : Nat)
  | release (label : String)

def Operation.encode : Operation → String
  | .reserve label id payload => s!"reserve,{label},{if id.isEmpty then "-" else id},{payload}"
  | .release label => s!"release,{label}"

def traces : List (String × List Operation) :=
  [("count", [.reserve "p" "a" 1, .reserve "q" "b" 1, .reserve "r" "c" 1, .release "p"]),
   ("bytes", [.reserve "p" "a" 3, .reserve "q" "b" 3, .reserve "r" "c" 1, .release "p", .release "q"]),
   ("duplicate", [.reserve "p" "a" 3, .reserve "q" "a" 12, .reserve "r" "c" 1, .release "p"]),
   ("reuse", [.reserve "p" "a" 3, .release "p", .reserve "q" "a" 2, .release "p", .release "q", .release "q"]),
   ("zero", [.reserve "p" "a" 0, .reserve "q" "b" 1, .release "p"]),
   ("empty", [.reserve "p" "" 1, .reserve "q" "a" 2, .release "p"]),
   ("oversize", [.reserve "p" "a" 1, .reserve "q" "a" (maxFrame + 1), .reserve "r" "b" 0, .release "p"])]

def snapshot (result : String) (state : State) : String :=
  s!"{result}:{state.active.length}:{state.bytes}:{state.failed}"

def observe (cap : Cap) (operations : List Operation) : List String := Id.run do
  let mut state : State := {}
  let mut tokens : List (String × Nat) := []
  let mut result : List String := []
  for op in operations do
    match op with
    | .reserve label id payload =>
      let (after, verdict) := reserve cap state id payload
      state := after
      match verdict with
      | .ok token =>
        tokens := (label, token) :: tokens
        result := snapshot "ok" state :: result
      | .error reason => result := snapshot reason.text state :: result
    | .release label =>
      if let some (_, token) := tokens.find? (fun entry => entry.1 == label) then
        state := release state token
      result := snapshot "ok" state :: result
  return result.reverse

def main : IO Unit := do
  IO.println "# count|bytes|trace|operations|snapshots"
  for count in [1, 2] do
    for bytes in [3, 8] do
      for (label, trace) in traces do
        let commands := String.intercalate ";" (trace.map Operation.encode)
        let observations := String.intercalate ";" (observe ⟨count, bytes⟩ trace)
        IO.println s!"{count}|{bytes}|{label}|{commands}|{observations}"
