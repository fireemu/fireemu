import ExportManagedSchema

open ManagedSchema

private def first (shape family : String) : List Observation :=
  let (codes, repeated) := if family = "array" then ([2, 1], true)
    else if family = "empty-array" then ([], true) else ([1], false)
  let sample : Observation := ⟨if shape = "shared" then "z" else "q", repeated, codes⟩
  if shape = "shared" then [sample] else [sample, ⟨"z", false, [0]⟩]

private def second (shape : String) : List Observation :=
  [⟨"a", false, [3]⟩, ⟨"z", true, [1, 2, 1]⟩] ++
    (if shape = "shared" then [] else [⟨"zz", false, [0]⟩])

private def render (row : Observation) : String :=
  String.intercalate ":" [row.name, if row.repeated then "yes" else "no",
    String.intercalate "," (row.codes.map toString)]

def main : IO Unit := do
  IO.println "# mode|order|shape|family|schema"
  for mode in ["kind", "all", "namespace", "exclude"] do
    for order in ["forward", "reverse"] do
      for shape in ["shared", "disjoint"] do
        for family in ["scalar", "array", "empty-array"] do
          let selected := if mode = "kind" then
              (if order = "forward" then first shape family ++ second shape
                else second shape ++ first shape family)
            else if mode = "exclude" then first shape family else []
          let expected := String.intercalate ";" ((infer selected).map render)
          IO.println (String.intercalate "|" [mode, order, shape, family, expected])
