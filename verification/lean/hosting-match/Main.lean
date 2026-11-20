import HostingMatch

open HostingMatch

def patterns :=
  [("literal", "/docs/readme"), ("star", "/docs/*"), ("globstar", "/docs/**"),
   ("dot", "/docs/.d"), ("negation", "!/docs/*"), ("double", "!!/docs/*"),
   ("comment", "#/docs/*"), ("empty", "")]

def paths :=
  [("root", "/"), ("normal", "/docs/readme"), ("hidden", "/docs/.d"), ("trailing", "/docs/"),
   ("collapsed", "/docs//readme"), ("nested", "/docs/sub/a"), ("elsewhere", "/other/a")]

def selections : List String := ["glob", "source", "shadow"]

def renderRule (rule : Rule) : String :=
  String.intercalate "|" [rule.glob, rule.source, rule.regexLiteral]

def line (id : String) (strict : Bool) (path : String) (rules : List Rule) : String :=
  let matched := rules.map (fun rule => if admitsRule strict rule path then "1" else "0")
  String.intercalate "\t"
    [id, if strict then "strict" else "emu", path, String.intercalate ";" (rules.map renderRule),
     String.intercalate "," matched, (firstRule strict path rules).map toString |>.getD "-"]

def sample (select value : String) : Rule :=
  match select with
  | "glob" => {glob := value}
  | "source" => {source := value}
  | _ => {glob := "/missing", source := value, regexLiteral := "/docs/readme"}

def main : IO Unit := do
  let matrix := [("strict", true), ("emu", false)].flatMap fun (profile, strict) =>
    patterns.flatMap fun (pattern, value) =>
      paths.flatMap fun (shape, path) =>
        selections.map fun select =>
          line s!"{profile}/{pattern}/{shape}/{select}" strict path [sample select value]
  let ordered : List Rule := [{source := "/other"}, {regexLiteral := "/docs/readme"},
    {source := "/docs/*"}, {glob := "/docs/**"}]
  let extras := [line "regex-first-of-three" true "/docs/readme" ordered,
    line "skip-miss-and-hidden-wild" false "/docs/.d" (ordered ++ [{source := "/docs/.d"}]),
    line "regex-miss" true "/docs/README" [{regexLiteral := "/docs/readme"}],
    line "glob-negation-retains-priority" true "/docs/readme"
      [{glob := "!/docs/*", source := "/docs/readme", regexLiteral := "/docs/readme"}],
    line "nested-dot-strict" true "/docs/.hidden/child" [{source := "/docs/**"}],
    line "nested-dot-emu" false "/docs/.hidden/child" [{source := "/docs/**"}]]
  let rows := matrix ++ extras
  IO.println s!"# {rows.length} cases."
  for row in rows do IO.println row
