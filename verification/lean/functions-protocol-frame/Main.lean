import FunctionsProtocolFrame

open FunctionsProtocolFrame

def bodies : List (String × String) :=
  [("ascii", "{\"z\":1,\"a\":2}"), ("utf8", "{\"text\":\"雪🌟\"}"), ("empty", ""), ("invalid", "{")]

def headers : List String :=
  ["decimal", "padded", "blank", "nondec", "digits-only", "oversize", "nine-digits", "clean"]

def layouts : List String := ["single", "concat", "short"]

def second : Bytes := bytes "true"

def hex (wire : Bytes) : String :=
  let digits := "0123456789abcdef".toList.toArray
  if wire.isEmpty then "-"
  else String.ofList (wire.flatMap fun b => [digits[b / 16]!, digits[b % 16]!])

def input (header layout : String) (payload : Bytes) : Bytes :=
  let tail := if layout = "short" then payload.dropLast else payload
  let decimalLength := bytes (toString payload.length)
  if header = "clean" then []
  else if header = "digits-only" then decimalLength
  else
    let declared :=
      if header = "decimal" then decimalLength
      else if header = "padded" then [48, 48] ++ decimalLength
      else if header = "nondec" then bytes "x"
      else if header = "oversize" then bytes (toString (maxFrameBytes + 1))
      else if header = "nine-digits" then bytes "000000000"
      else []
    declared ++ [10] ++ tail ++ (if layout = "concat" then encode second else [])

def acceptedBody (payload : Bytes) : Bool :=
  let valid := bodies.filter (fun (label, _) => label = "ascii" ∨ label = "utf8")
  payload == second || valid.any (fun (_, text) => payload == bytes text)

/-- JSON validity is supplied by the fixture payload alphabet, rather than by a JSON grammar. -/
def answers : Nat → Bytes → List String
  | 0, _ => []
  | fuel + 1, wire =>
    match scan 0 0 wire with
    | .eof => ["eof"]
    | .short => ["short"]
    | .malformed => ["malformed"]
    | .tooLarge => ["too-large"]
    | .done length rest =>
      match splitPayload length rest with
      | none => ["short"]
      | some (payload, suffix) =>
        if acceptedBody payload then ("ok:" ++ hex payload) :: answers fuel suffix
        else ["json"]

def row (header body layout text : String) : String :=
  let payload := bytes text
  let wire := input header layout payload
  let canonical := if acceptedBody payload then hex (encode payload) else "-"
  String.intercalate "\t" [header, body, layout, hex wire, hex payload, canonical,
    String.intercalate "," (answers 3 wire)]

def main : IO Unit := do
  IO.println s!"# {headers.length * bodies.length * layouts.length + 1} cases."
  for header in headers do
    for (label, body) in bodies do
      for layout in layouts do
        IO.println (row header label layout body)
  let exactMaximum := bytes (toString maxFrameBytes) ++ [10]
  IO.println (String.intercalate "\t" ["maximum", "empty", "single", hex exactMaximum, "-", "-",
    String.intercalate "," (answers 3 exactMaximum)])
