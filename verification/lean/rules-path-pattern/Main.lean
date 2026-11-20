import RulesPathPattern

open RulesPathPattern

def paths : List (String × String × List String) :=
  [("base", "", []),
   ("direct", "/items/a", ["items", "a"]),
   ("nested", "/items/a/notes/b", ["items", "a", "notes", "b"]),
   ("prefix", "/groups/g/items/b", ["groups", "g", "items", "b"]),
   ("repeated", "/items/root/items/a", ["items", "root", "items", "a"]),
   ("wrong", "/other/a", ["other", "a"]),
   ("nestedWrong", "/items/a/siblings/b", ["items", "a", "siblings", "b"]),
   ("deep", "/items/a/notes/b/comments/c", ["items", "a", "notes", "b", "comments", "c"]),
   ("emptySegments", "/items//a/", ["items", "a"])]

def main : IO Unit := do
  let versions := [("one", Version.one), ("two", .two)]
  let layouts := [("single", Layout.single), ("nested", .nested),
    ("trailing", .trailing), ("leading", .leading)]
  IO.println "# 72 cases"
  for (versionName, version) in versions do
    for (layoutName, layout) in layouts do
      for (pathName, pathText, segments) in paths do
        let result :=
          if !admissible version layout then ["reject", "-", "-", "-"]
          else
            match captures version layout segments with
            | none => ["miss", "-", "-", "-"]
            | some bindings =>
              let rest := bindings.recursive.map (fun values => "/" ++ String.intercalate "/" values)
              ["match", bindings.id, bindings.nestedId.getD "-", rest.getD "-"]
        IO.println (String.intercalate "\t" ([versionName, layoutName, pathName, pathText] ++ result))
