import RunnerStructuredLog

open RunnerStructuredLog

def shapes : List (String × Root) :=
  [("object", .object), ("space", .whitespaceObject), ("array", .array),
   ("null", .null), ("number", .number), ("malformed", .malformed), ("plain", .plain)]

def inputs : List String :=
  ["Notice", "wArNiNg", "DEBUG", "INFO", "ERROR", "CRITICAL", "ALERT", "EMERGENCY",
   "DEFAULT", "trailing-space ", "missing", "numeric"]

def payloads : List (String × Payload) :=
  [("scalar", ⟨2, true⟩), ("pair", ⟨2, true⟩), ("depth64", ⟨64, true⟩),
   ("depth65", ⟨65, true⟩), ("bad-key", ⟨2, false⟩), ("bad-value", ⟨2, false⟩)]

def main : IO Unit := do
  IO.println "# shape|argument-count|severity|payload|message|structured-level"
  for (tag, root) in shapes do
    for args in [1, 2] do
      for severity in inputs do
        for (payloadName, payload) in payloads do
          let chosen := (output args root severity payload).getD "-"
          for message in ["text", "absent", "numeric"] do
            IO.println <| String.intercalate "|" [tag, toString args, severity, payloadName, message, chosen]
