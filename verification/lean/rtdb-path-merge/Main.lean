import RtdbPathMerge
open RtdbPathMerge

def roots : List (String × Tree) :=
  [("branch", .branch [("a", .leaf 4), ("b", .leaf 7)]), ("scalar", .leaf 8), ("empty", .absent)]

def pairs : List (String × String × String) :=
  [("siblings", "items/a", "items/b"), ("alias", "items/a", "/items//a/"),
   ("parent", "items", "items/a"), ("reverse", "items/a", "items"),
   ("invalid", "items/a", "items/b.d"), ("readonly", "items/a", ".info/x")]

def operations (value : Int) : List (String × Operation) :=
  [("set", .put value), ("delete", .remove), ("increment", .increment value)]

def describe (tree : Tree) : String :=
  match child tree "items" with
  | .absent => "absent"
  | .leaf n => s!"leaf:{n}"
  | .branch children =>
    "branch:" ++ ",".intercalate ((children.mergeSort fun a b => a.1 ≤ b.1).map fun (key, value) =>
      match value with
      | .leaf n => s!"{key}={n}"
      | _ => panic! "the corpus uses one-level value branches")

def refusalName : Refusal → String
  | .invalidKey => "invalidKey"
  | .readOnly => "readOnly"
  | .overlapping => "overlapping"
  | .invalidValue => "invalidValue"

def main : IO Unit := do
  for (initial, items) in roots do
    let children := match items with
      | .absent => [("untouched", Tree.leaf 99)]
      | _ => [("untouched", .leaf 99), ("items", items)]
    let before : Tree := .branch children
    for (shape, p, q) in pairs do
      for (first, x) in operations 2 do
        for (second, y) in (operations 3) ++ [("badValue", .malformed)] do
          let result := transaction before [(p, x), (q, y)]
          let status := match result with | .ok _ => "ok" | .error err => refusalName err
          IO.println <| "\t".intercalate [initial, shape, first, second, status, describe (after before result)]
