import AppCheckAdmission

open AppCheckAdmission

private def names : List (String × String) :=
  [("canonical", "x-firebase-appcheck"), ("mixed", "X-FiReBaSe-AppCheck"),
    ("other", "x-firebase-app-check")]

private def values : List (String × String) :=
  [("good", "a.b+/=-!"), ("empty", ""), ("limit", String.ofList (List.replicate 16384 'z')),
    ("oversized", String.ofList (List.replicate 16385 'z')), ("unicode", "é"),
    ("comma", "a,b"), ("space", "a b"), ("control", "a\tb")]

private def headerRows : List String := Id.run do
  let mut rows := #[]
  for (nameTag, name) in names do
    for count in ["none", "one", "two"] do
      for (valueTag, value) in values do
        let matched := if count == "none" then [] else if count == "one" then [(name, value)]
                       else [(name, value), (name, "another")]
        let fields := ("authorization", "ignored") :: matched
        let result := match classify (collect fields) with
          | .missing => "missing"
          | .present _ => "present"
          | .malformed => "malformed"
        rows := rows.push s!"header {nameTag} {count} {valueTag} {result}"
  return rows.toList

private def uuid (style version variant shape : String) : String :=
  let first := match shape with
    | "shifted" => "bcdef01"
    | "invalid" => "gbcdef01"
    | "unicode" => "ébcdef01"
    | _ => "abcdef01"
  let groups := [first, "1234", version ++ "abc", variant ++ "def",
    (if shape == "shifted" then "0" else "") ++ "0123456789ab"]
  let input := String.intercalate (if shape == "compact" then "" else "-") groups
  if style == "upper" then input.toUpper else input

private def uuidRows : List String := Id.run do
  let mut rows := #[]
  for style in ["lower", "upper"] do
    for version in ["4", "5"] do
      for variant in ["7", "8", "9", "a", "b", "c"] do
        for shape in ["canonical", "compact", "shifted", "invalid", "unicode"] do
          let input := uuid style version variant shape
          rows := rows.push s!"uuid {style} {version} {variant} {shape} {input} {(normalize input).getD "-"}"
  return rows.toList

def main : IO Unit := do
  let rows := headerRows ++ uuidRows
  IO.println s!"# cases {rows.length}"
  for row in rows do IO.println row
