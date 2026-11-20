import FunctionsOrderedJson

open FOJ

def hexDigit (n : Nat) : Char := Char.ofNat (if n < 10 then n + 48 else n + 87)

def encode (s : String) : String :=
  String.ofList (s.toUTF8.data.toList.flatMap fun b => [hexDigit (b.toNat / 16), hexDigit (b.toNat % 16)])

def values : List (String × List Value) := [
  ("scalar", [.atom (.unsigned 1), .atom (.boolean true), .atom .nil]),
  ("escaped", [.atom (.text "héllo"), .atom (.text "a\tb"), .atom (.text "x\"\n\\y")]),
  ("nested", [.array [.nil, .boolean false], .object [("é", .unsigned 2)], .array []])
]

def main : IO Unit := do
  IO.println "# keys|value|lookup|wire hex|pretty hex|first hex or -|last hex or -"
  for (layout, keys) in [
      ("unordered", ["z", "a"]), ("duplicate", ["a", "a"]),
      ("separated", ["a", "z", "a"]), ("empty", [])] do
    for (kind, items) in values do
      let members := keys.zip items
      let wire := objectText false 0 (valueText false 1) members
      let pretty := objectText true 0 (valueText true 1) members
      for key in ["a", "z", "missing"] do
        let earlier := (first members key).map (encode ∘ valueText true 0)
        let later := (last members key).map (encode ∘ valueText false 0)
        IO.println s!"{layout}|{kind}|{key}|{encode wire}|{encode pretty}|{earlier.getD "-"}|{later.getD "-"}"
