import RulesUtf16Slices

open RulesUtf16Slices

def subjects : List (String × List Nat) :=
  [("empty", []), ("ascii", [97, 98, 99]), ("bmp", [233, 32768, 65533]),
   ("pair", [0xd83d, 0xde00]), ("middlePair", [233, 0xd83d, 0xdd25, 120]),
   ("lone", [0xd83d, 120, 0xde00]), ("reversedPair", [0xde00, 0xd83d]),
   ("twoPairs", [0xd800, 0xdc00, 0xd800, 0xdc00])]

def probes (length : Int) : List (String × Int × Int) :=
  [("full", 0, length), ("first", 0, 1), ("last", length - 1, length),
   ("middle", 1, 2), ("emptyFirst", 0, 0), ("emptyInner", 1, 1),
   ("emptyEnd", length, length), ("negative", -1, 1), ("past", length, length + 1),
   ("reversed", 2, 1), ("cutPrefix", 0, 2), ("cutSuffix", 1, length)]

def unitText (units : List Nat) : String := String.intercalate "," (units.map toString)

def outcomeText : Selection → String
  | .text units => "text:" ++ unitText units
  | .fragment unit => s!"fragment:{unit}"
  | .invalidIndex => "invalidIndex"
  | .invalidRange => "invalidRange"
  | .cutPair => "cutPair"

def main : IO Unit := do
  IO.println "# 384 cases"
  for (mode, profile) in [("production", Profile.production), ("official", .official)] do
    for (shape, units) in subjects do
      for operation in ["index", "slice"] do
        for (probe, lo, hi) in probes units.length do
          let outcome := if operation == "index" then index profile units lo else slice profile units lo hi
          IO.println (String.intercalate "\t" [mode, shape, operation, probe, toString lo, toString hi,
            unitText units, outcomeText outcome])
