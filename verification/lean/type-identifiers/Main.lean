import TypeIdentifiers

def hexDigit (n : Nat) : Char :=
  Char.ofNat (if n < 10 then 48 + n else 87 + n)

def hex (s : String) : String :=
  String.ofList <| s.toUTF8.data.toList.flatMap fun n =>
    [hexDigit (n.toNat / 16), hexDigit (n.toNat % 16)]

def result : Option TI.Failure → String
  | none => "ok"
  | some .empty => "empty"
  | some (.tooLong n b) => s!"long:{n}:{b}"
  | some (.invalidCharacter i) => s!"invalid:{i}"
  | some .hyphen => "hyphen"
  | some .slash => "slash"
  | some .dot => "dot"
  | some .dunder => "dunder"
  | some (.control i) => s!"control:{i}"

def main : IO Unit := do
  IO.println "# kind|shape|width|utf8|result"
  for k in [TI.Kind.project, .database, .catalog, .collection, .document] do
    for (shape, sample) in [
      ("plain", "a1"), ("utf8", "𐀀é"), ("slash", "a/b"), ("control", "é\u0085z"),
      ("both", "\u0001/"), ("hyphen", "-z"), ("capital", "aB"), ("dunder", "__a__"),
      ("dot", ".."), ("default", "(default)")
    ] do
      for (width, target) in [("small", sample.utf8ByteSize), ("exact", k.limit), ("over", k.limit + 1)] do
        let s := sample ++ String.ofList (List.replicate (target - sample.utf8ByteSize) 'x')
        IO.println s!"{k.label}|{shape}|{width}|{hex s}|{result (TI.refusal k s)}"
    IO.println s!"{k.label}|empty|small||{result (TI.refusal k "")}"
