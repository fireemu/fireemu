import RunnerParameterDefaults

open RunnerParameterDefaults

def digit (n : Nat) : Char := Char.ofNat (if n < 10 then n + 48 else n + 87)

def text : Option String → String
  | none => "-"
  | some string => String.ofList <| string.toUTF8.data.toList.flatMap fun byte =>
      [digit (byte.toNat / 16), digit (byte.toNat % 16)]

def entries (values : List String) : String :=
  if values.isEmpty then "-" else String.intercalate "," values

def kinds : List (String × Default) :=
  [("text", .serialized "first"), ("integer", .serialized "-9"), ("boolean", .serialized "false"),
   ("list", .serialized "[\"left\",\"right\"]"), ("unsupported", .unsupported), ("throwing", .thrown),
   ("absent", .absent)]

def declarations (order : String) (value : Default) : List Declaration :=
  let base : Declaration := ⟨"base", false, value⟩
  let dependent : Declaration := ⟨"dependent", false, .reference "base"⟩
  let fallback : Declaration := ⟨"base", false, .serialized "fallback"⟩
  let selected :=
    if order == "normal" then [base, dependent]
    else if order == "reversed" then [dependent, base]
    else [base, fallback, dependent]
  [⟨"", false, .serialized "ignored"⟩, ⟨"secret", true, .thrown⟩] ++ selected

def main : IO Unit := do
  IO.println "# prior|default|order|base encoded|dependent encoded|missing|defaulted|evaluated"
  for (prior, env) in [("missing", []), ("empty", [("base", "")]), ("existing", [("base", "from-env")])] do
    for (kind, value) in kinds do
      for order in ["normal", "reversed", "duplicate"] do
        let result := run env (declarations order value)
        IO.println s!"{prior}|{kind}|{order}|{text (lookup result.env "base")}|{text (lookup result.env "dependent")}|{entries result.missing}|{entries result.assigned}|{entries result.evaluated}"
