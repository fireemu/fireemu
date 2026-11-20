import EventarcChannelLifecycle

open ECL

def actionName : Action → String
  | .observe => "lookup"
  | .create => "create"
  | .declare => "declare"
  | .delete => "delete"

def statusName : Status → String
  | .observed => "observed"
  | .created => "created"
  | .declared => "declared"
  | .exists => "exists"
  | .deleted => "deleted"
  | .missing => "missing"

def phaseName : Phase → String
  | .absent => "absent"
  | .creating => "creating"
  | .ready => "ready"
  | .deleting => "deleting"

def encode (before : State) (stepInput : Action × Nat) : String × State :=
  let (a, wall) := stepInput
  let (status, state) := step before a wall
  let details := match metadata state with
    | none => "-"
    | some (id, created, updated) => s!"{id},{created},{updated}"
  let completed := String.ofList (state.operationEnds.map fun e => if state.clock ≥ e then '1' else '0')
  (s!"{actionName a},{wall},{statusName status},{phaseName (phase state)},{details},{completed}", state)

def actions (initial : Action) (deleteAt : Nat) (clock : String) : List (Action × Nat) :=
  [(initial, 10), (.observe, 10), (.delete, deleteAt), (.delete, deleteAt), (.create, deleteAt)] ++
    (if clock == "rewind" then [(.observe, 2), (.declare, 1)]
     else if clock == "exact" then [(.observe, 13), (.observe, 14)]
     else [(.observe, 15)]) ++
    [(.observe, 16), (.observe, 17), (.observe, 19), (.observe, 20), (.create, 21),
     (.declare, 22), (.observe, 25), (.observe, 24), (.delete, 26), (.observe, 29)]

def main : IO Unit := do
  IO.println "# initial|deleteAt|clock|ordered action, wall, answer, phase, identity/time data, operation bits"
  for (label, initial) in [("create", Action.create), ("declare", .declare), ("absent", .observe)] do
    for (point, deleteAt) in [("early", 11), ("ready", 14), ("late", 17)] do
      for clock in ["forward", "rewind", "exact"] do
        let (rows, _) := (actions initial deleteAt clock).foldl
          (fun (rows, state) a => let (row, next) := encode state a; (rows ++ [row], next)) ([], {})
        IO.println s!"{label}|{point}|{clock}|{String.intercalate ";" rows}"
