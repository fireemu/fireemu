import PythonRunnerDuplicateMembers

open PyDuplicate

private def escapeAlias (key : String) : String :=
  match key with
  | "size" => "\\u0073ize"
  | "name" => "\\u006eame"
  | "é" => "\\u00e9"
  | _ => "\\u007a"

private def keyPair (shape : String) : String × String :=
  match shape with
  | "known" => ("size", "z")
  | "unknown" => ("é", "z")
  | "mixed" => ("é", "name")
  | _ => ("size", "name")

private def inputMember (alias : String) (again : Bool) (member : Member) : String :=
  let key := if alias = "escaped" || (alias = "mixed" && again) then
    escapeAlias member.1
  else member.1
  "\"" ++ key ++ "\":" ++ member.2

private def hex (s : String) : String :=
  let digits := "0123456789abcdef".toList.toArray
  String.ofList <| s.toUTF8.data.toList.flatMap fun x =>
    [digits[x.toNat / 16]!, digits[x.toNat % 16]!]

def main : IO Unit := do
  IO.println "# shape|alias|repeat|layout|input-hex|output-hex"
  for shape in ["known", "unknown", "mixed", "two-known"] do
    let (a, b) := keyPair shape
    let initial := [(a, "1e-7"), (b, "-0.0")]
    for alias in ["literal", "escaped", "mixed"] do
      for sequence in ["none", "first", "second", "both"] do
        let duplicates :=
          (if sequence = "first" || sequence = "both" then [(a, "42")] else []) ++
          (if sequence = "second" || sequence = "both" then [(b, "4E+2")] else [])
        let raw := "{" ++ String.intercalate "," (initial.map (inputMember alias false) ++
          duplicates.map (inputMember alias true)) ++ "}"
        let decoded := decode (initial ++ duplicates)
        for output in ["compact", "pubsub", "storage"] do
          IO.println (String.intercalate "|" [shape, alias, sequence, output, hex raw,
            hex (layout output decoded)])
