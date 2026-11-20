import CoreJson

open CoreJson

def leads : List (String × String) := [("empty", ""), ("ws", " \t\r\n")]
def frames : List String := ["root", "array", "object"]

def lexemes : List (String × String) :=
  [("simple", "true"), ("unicode", "\"é😀\""), ("pair", "\"\\ud800\\udc00\""),
    ("low", "\"é\\udc00\""), ("badHex", "\"\\u+123\""),
    ("invalidEscape", "\"\\é\""), ("badLiteral", "tru"),
    ("negative", "-9223372036854775808"), ("leading", "-01"),
    ("fraction", "2."), ("exponent", "5E+"), ("overflow", "9223372036854775808")]

def frameText (frame lexeme : String) :=
  if frame == "array" then "[" ++ lexeme ++ "]"
  else if frame == "object" then "{\"p\":" ++ lexeme ++ "}" else lexeme

def row (labels : List String) (input : String) : String :=
  let source := if input.isEmpty then "-" else hex input
  let result := match parse input with
    | .ok v => ["ok", display v]
    | .error e => ["err", toString e.byte, e.expected]
  String.intercalate "\t" (labels ++ [source] ++ result)

def matrix : List String :=
  leads.flatMap fun (lead, leading) =>
    frames.flatMap fun frame =>
      lexemes.map fun (kind, lexeme) => row [lead, frame, kind] (leading ++ frameText frame lexeme)

def replicate (n : Nat) (c : Char) := String.ofList (List.replicate n c)

def special : List String :=
  [ "", " ", "null false", "+1", "-", "0", "-0", "0.5", "1e-9", "1E9000",
    "-9223372036854775809", "9223372036854775807", "false", "\"", "\"\\",
    "\"\\\"\\\\\\/\\b\\f\\n\\r\\t\"", "\"\n\"", "\"\\udbff\\udfff\"",
    "\"\\ud800\"", "\"\\ud800\\u0061\"", "\"\\ud800\\u00xx\"", "\"\\ud7ff\\ue000\"",
    "\"\\u0000\\u001F\"", "\"é\"?", "{\"x\":1,\"\\u0078\":2,\"a\":3}",
    "{\"b\":1,\"a\":2,\"b\":[3]}", "{\"é\":7,\"a\":8}", "{\"a\" true}",
    "{\"a\":true,}", "{\"a\":true  }", "[1,]", "[\"😀\" 1]", "[1", "{", "[", "{}",
    replicate 64 '[' ++ "null" ++ replicate 64 ']',
    replicate 65 '[' ++ "null" ++ replicate 65 ']',
    replicate 65 '[' ++ replicate 65 ']',
    replicate 66 '[' ++ replicate 66 ']' ]

def main : IO Unit := do
  let rows := matrix ++ special.map (row ["curated", "curated", "curated"])
  IO.println s!"# {rows.length} cases"
  rows.forM IO.println
