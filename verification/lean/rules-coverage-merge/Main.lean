import RulesCoverageMerge

open RulesCoverageMerge

def batches : List (String × List Nat) :=
  [("empty", []), ("sparse", [900]), ("overlap", [3, 900, 3, 900, 1200]),
   ("full", List.range 64), ("overflow", List.range 71 ++ [7, 68, 900, 0])]

def inputText (items : List Nat) : String := String.intercalate "," (items.map toString)

def keptText (summary : Summary) : String :=
  String.intercalate "," (summary.kept.map fun (key, count) => s!"{key}:{count}")

def main : IO Unit := do
  IO.println "# 125 cases"
  for (leftName, left) in batches do
    for (middleName, middle) in batches do
      for (rightName, right) in batches do
        let a := record 64 left
        let b := record 64 middle
        let c := record 64 right
        let leftFirst := merge 64 (merge 64 a b) c
        let rightFirst := merge 64 a (merge 64 b c)
        IO.println (String.intercalate "\t" [leftName, middleName, rightName,
          inputText left, inputText middle, inputText right,
          keptText leftFirst, toString leftFirst.omitted, keptText rightFirst,
          toString rightFirst.omitted])
