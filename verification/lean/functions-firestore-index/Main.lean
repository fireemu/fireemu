import FunctionsFirestoreIndex

open FirestoreIndex

def layout (size : Nat) (reversed : Bool) : List Function :=
  let functions := (List.range size).map fun i =>
    { name := size - i
      database := if i % 7 == 6 then none else some (if i % 2 == 0 then "primary" else "archive")
      declared := i % 4
      shape := i % 4 }
  if reversed then functions.reverse else functions

def encode (selected : List (Nat × Nat × String)) : String :=
  String.intercalate "," (selected.map fun (fn, kind, capture) => s!"{fn}:{kind}:{capture}")

def main : IO Unit := do
  IO.println "# functions|reverse|database|event|path shape|ordered name:kind:parameter"
  for size in [1, 16, 64, 65, 96] do
    for reverse in [false, true] do
      let functions := layout size reverse
      for database in ["primary", "archive", "missing"] do
        for event in List.range 4 do
          for shape in List.range 4 do
            let paths := #["posts/絵", "users/絵", "posts/fixed/child/絵", "other/絵"]
            let selected := scan ⟨database, event, shape, "絵", paths[shape]!⟩ functions
            IO.println s!"{size}|{reverse}|{database}|{event}|{shape}|{encode selected}"
