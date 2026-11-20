import RunnerLogBounds

open RunnerLogBounds

def hexDigit (n : Nat) : Char :=
  Char.ofNat (if n < 10 then 48 + n else 87 + n)

def hexText (chars : List Char) : String :=
  let bytes := (String.ofList chars).toUTF8.data.toList
  if bytes.isEmpty then "-" else
    String.ofList <| bytes.flatMap fun byte => [hexDigit (byte.toNat / 16), hexDigit (byte.toNat % 16)]

def shapes : List (String × List Nat) :=
  [("empty", []), ("ascii", List.replicate 22 97),
   ("mixed", (List.replicate 6 [97, 0x00e9, 0x20ac]).flatten),
   ("pair", (List.replicate 6 [0xd83d, 0xde00]).flatten),
   ("isolated", (List.replicate 6 [0xd800, 97, 0xdc00]).flatten),
   ("adjacent", (List.replicate 6 [0xd800, 0xd83d, 0xde00, 0xdc00]).flatten)]

def main : IO Unit := do
  IO.println "# shape|prefix|budget|limit|UTF-16 decimal units|UTF-8 hex"
  for (shape, body) in shapes do
    for (tag, leading) in [("bare", []), ("prefixed", [97, 0x20ac])] do
      let units := leading ++ body
      let chars := normalize units
      for (budget, limit) in [
        ("zero", 0), ("submarker", 14), ("marker", 15), ("one", 16), ("two", 17),
        ("three", 18), ("four", 19), ("exact", bytes chars), ("above", bytes chars + 1)] do
        let input := if units.isEmpty then "-" else String.intercalate "," (units.map toString)
        IO.println s!"{shape}|{tag}|{budget}|{limit}|{input}|{hexText (bound limit chars)}"
