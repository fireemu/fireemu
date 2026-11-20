import SessionFault

open SessionFault

def choices : List (String × Option (List Rule)) :=
  [("none", none),
   ("all", some [⟨"invoke", none, none, none, 1⟩]),
   ("global", some [⟨"invoke", none, none, some 2, 2⟩]),
   ("function", some [⟨"invoke", some "f1", none, some 1, 3⟩]),
   ("event", some [⟨"invoke", none, some "created", none, 4⟩]),
   ("event-occurrence", some [⟨"invoke", some "f2", some "created", some 2, 6⟩]),
   ("overlap", some [⟨"invoke", some "f2", none, some 2, 5⟩, ⟨"invoke", none, none, none, 1⟩,
     ⟨"invoke", none, some "created", none, 4⟩, ⟨"invoke", none, none, none, 1⟩])]

def operations := ["invoke", "read"]
def functions : List (Option String) := [none, some "f1", some "f2"]
def events : List (Option String) := [none, some "created", some "deleted"]

def showOptional {α : Type} [ToString α] (x : Option α) : String :=
  x.map toString |>.getD "-"

def showFired (entry : Fired) : String :=
  String.intercalate ":" [entry.operation, showOptional entry.function, toString entry.occurrence,
    showOptional entry.functionOccurrence, toString entry.action]

def showList {α : Type} (f : α → String) (xs : List α) : String :=
  if xs.isEmpty then "-" else String.intercalate "," (xs.map f)

def countKeys : List (String × Option String) :=
  operations.flatMap (fun operation => functions.map (operation, ·))

def selectionRow (name : String) (rules : Option (List Rule)) (call : Call) : String :=
  let first : Call := ⟨"invoke", some "f2", some "deleted"⟩
  let counts := countKeys.map fun (operation, f) =>
    if rules.isNone then 0
    else [first, call].countP (fun (c : Call) => c.operation == operation && f.all (some · == c.function))
  String.intercalate "\t" [name, call.operation, showOptional call.function, showOptional call.event,
    showList toString (select (rules.getD []) [first] call),
    showList showFired (fired rules [first, call]), showList toString counts]

def historyRows : List (Nat × Nat) := [(1, 999), (1, 1000), (1, 1001), (2, 500), (2, 501)]

def historyRow (matchesPerCall n : Nat) : String :=
  let plan := (List.range matchesPerCall).map fun i => (⟨"invoke", none, none, none, i + 1⟩ : Rule)
  let calls := List.replicate n (⟨"invoke", some "f1", none⟩ : Call)
  let all := fired (some plan) calls
  let kept := retained 1000 all
  String.intercalate "\t" ["history", toString matchesPerCall, toString n,
    toString (all.length - kept.length), showList showFired kept]

def main : IO Unit := do
  let cases := choices.length * operations.length * functions.length * events.length
  IO.println s!"# {cases + historyRows.length} cases."
  for (name, rules) in choices do
    for op in operations do
      for f in functions do
        for event in events do
          IO.println (selectionRow name rules ⟨op, f, event⟩)
  for (matchesPerCall, n) in historyRows do
    IO.println (historyRow matchesPerCall n)
