import ExportLevelDb

open ExportLevelDb

def leading : List (String × List Nat) :=
  [("none", []), ("ordinary", [13]), ("pad1", [capacity - 1]),
    ("pad6", [capacity - 6]), ("header", [capacity - headerSize])]

def body : List (String × Nat) :=
  [("empty", 0), ("small", 16), ("capacity", capacity),
    ("overflow", capacity + 1), ("three", capacity * 2 + 1)]

def following : List (String × List Nat) :=
  [("none", []), ("one", [37])]

def formatPiece : Piece → String
  | .padding n => s!"pad:{n}"
  | .full n => s!"1:{n}"
  | .first n => s!"2:{n}"
  | .middle n => s!"3:{n}"
  | .last n => s!"4:{n}"

def main : IO Unit := do
  IO.println "# LEADING BODY FOLLOWING LENGTHS FRAMES, tab separated"
  for (leadingCase, begin) in leading do
    for (bodyCase, length) in body do
      for (followingCase, ending) in following do
        let records := begin ++ [length] ++ ending
        IO.println ("\t".intercalate [leadingCase, bodyCase, followingCase,
          ",".intercalate (records.map toString),
          ",".intercalate ((layouts 0 records).map formatPiece)])
