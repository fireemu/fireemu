import RulesLexicalFunctions

open RulesLexicalFunctions

def shapes (base : Nat) : List (String × Scope) :=
  [("absent", []), ("single", [("pick", base)]),
   ("duplicate", [("pick", base), ("pick", base + 1)]),
   ("other", [("unrelated", base)])]

def main : IO Unit := do
  IO.println "# 64 cases"
  for (outerName, outer) in shapes 10 do
    for (innerName, inner) in shapes 20 do
      for (callName, wrapper) in [("direct", false), ("wrapper", true)] do
        for sibling in ["absent", "present"] do
          let expected := match checkedCall wrapper outer inner with
            | none => "duplicate"
            | some result => result.map toString |>.getD "missing"
          IO.println (String.intercalate "\t" [outerName, innerName, callName, sibling, expected])
