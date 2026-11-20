import FirestoreIndexConfig

open FirestoreIndexConfig

def names : List (String × Profile) := [("emu", .emulator), ("deploy", .deploy)]
def scopes : List (String × Scope) := [("collection", .collection), ("group", .group)]

def counts : List Nat := [0, 1, 2, 100, 101]

def layouts : List (String × List Kind) :=
  [("ordinary", []), ("array", [.arrayContains]), ("two-arrays", [.arrayContains, .arrayContains]),
   ("name", [.documentName]), ("vector", [.vector])]

def outcome : Except ShapeError Unit → String
  | .ok () => "ok"
  | .error .tooMany => "too-many"
  | .error .multipleArrays => "multiple-arrays"
  | .error .unnecessary => "unnecessary"

def main : IO Unit := do
  let rows := names.flatMap fun (profileName, profile) =>
    scopes.flatMap fun (scopeName, scope) =>
      counts.flatMap fun count =>
        layouts.map fun (layout, head) =>
          let fields := (head ++ List.replicate count Kind.ordered).take count
          String.intercalate "\t" [s!"{profileName}/{scopeName}/{count}/{layout}",
            profileName, scopeName, toString count, layout, outcome (check profile ⟨scope, fields⟩)]
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
