import AuthPasswordPolicy

open AuthPasswordPolicy

private def defaultPunctuation : List Char :=
  "^$*.[]{}()?\"!@#%&/\\,><':;|_~`-".toList

private def policies : List (String × Policy) :=
  [ ("length", ⟨6, some 8, false, false, false, false, defaultPunctuation⟩)
  , ("classes", ⟨6, some 8, true, true, true, true, defaultPunctuation⟩)
  , ("custom", ⟨6, some 8, true, true, true, true, ['+', ' ']⟩) ]

private def samples : List (String × String) :=
  [ ("empty", ""), ("short", "aA1!"), ("min", "abcA1!"), ("max", "abcdeA1!")
  , ("above", "abcdefA1!"), ("emoji", "😀😀😀"), ("unicode", "éÅ١😀+")
  , ("symbols", "abcA1+"), ("custom", "abcA1 ") ]

private def states : List (String × Enforcement) :=
  [("off", .off), ("unspecified", .unspecified), ("enforce", .enforce)]

private def operations : List (String × Operation) :=
  [ ("register", .register), ("add", .add), ("change", .change), ("admin", .admin)
  , ("reset", .reset), ("signin", .signin) ]

private def violationName : Violation → String
  | .minimum => "MINIMUM_PASSWORD_LENGTH"
  | .maximum => "MAXIMUM_PASSWORD_LENGTH"
  | .lowercase => "MISSING_LOWERCASE_CHARACTER"
  | .uppercase => "MISSING_UPPERCASE_CHARACTER"
  | .numeric => "MISSING_NUMERIC_CHARACTER"
  | .punctuation => "MISSING_NON_ALPHANUMERIC_CHARACTER"

private def policyRows : List String := Id.run do
  let mut rows := #[]
  for (stateName, state) in states do
    for (forceName, force) in [("no", false), ("yes", true)] do
      for (operationName, operation) in operations do
        for (policyName, policy) in policies do
          for (sampleName, password) in samples do
            let codes := violations policy password
            let codeText := if codes.isEmpty then "-" else String.intercalate "," (codes.map violationName)
            let decision := if rejects state force operation policy password then "reject" else "allow"
            rows := rows.push s!"policy {stateName} {forceName} {operationName} {policyName} {sampleName} {codeText} {decision}"
  return rows.toList

private def configRows : List String := Id.run do
  let mut rows := #[]
  for min in [5, 6, 7, 29, 30, 31] do
    for max in [none, some 5, some 6, some 30, some 4096, some 4097] do
      for (name, punctuation) in
          [("empty", []), ("plus", ['+']), ("space", [' ']), ("alpha", ['A']),
           ("control", [Char.ofNat 127]), ("unicode", ['é'])] do
        let result := match validateConfiguration min max punctuation with
          | none => "valid"
          | some .minimum => "min"
          | some .maximum => "max"
          | some .punctuation => "punctuation"
        rows := rows.push s!"config {min} {(max.map toString).getD "-"} {name} {result}"
  return rows.toList

def main : IO Unit := do
  let rows := policyRows ++ configRows
  IO.println s!"# cases {rows.length}"
  for row in rows do IO.println row
