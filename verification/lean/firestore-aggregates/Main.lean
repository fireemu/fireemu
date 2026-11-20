import FirestoreAggregates

open FirestoreAggregates

private def whole (n : Int) : Entry := .number (.whole n)
private def fp (bits : UInt64) : Entry := .number (.double (Float.ofBits bits))

private def datasets : List (String × List Row) :=
  [("empty", []),
   ("mixed", [⟨true, true, .missing, whole 9⟩, ⟨true, true, .text, whole 3⟩,
     ⟨false, true, whole 12, whole 1⟩, ⟨true, false, whole 4, .missing⟩,
     ⟨true, true, .null, whole 1⟩, ⟨true, true, whole 8, whole (-3)⟩,
     ⟨true, false, whole 9, whole 7⟩]),
   ("numeric", [⟨true, true, whole 1, whole (-1)⟩, ⟨true, true, whole (-3), whole 5⟩,
     ⟨true, true, whole 8, fp 0x4004000000000000⟩, ⟨true, true, fp 0x8000000000000000, whole 6⟩]),
   ("overflow", [⟨true, true, whole maxI64, whole minI64⟩, ⟨true, true, whole 1, whole (-1)⟩,
     ⟨true, true, whole (-2), whole 2⟩]),
   ("special", [⟨true, true, fp 0x7ff0000000000000, whole 1⟩,
     ⟨true, false, fp 0xfff0000000000000, whole 2⟩,
     ⟨true, true, fp 0x7ff8000000000000, fp 0x3ff8000000000000⟩]),
   ("nonnumeric", [⟨true, true, .text, .null⟩, ⟨true, false, .null, .text⟩,
     ⟨true, true, .text, .missing⟩, ⟨true, true, .missing, .null⟩])]

private def numberText : Number → String
  | .whole n => s!"i{n}"
  | .double f => if f.isNaN then "nan" else s!"d{f.toBits.toNat}"

private def entryText : Entry → String
  | .missing => "-"
  | .text => "text"
  | .null => "null"
  | .number n => numberText n

private def datasetText (rows : List Row) : String :=
  if rows.isEmpty then "-" else
    String.intercalate ";" (rows.map (fun row => String.intercalate ":"
      [toString row.visible, toString row.rankPresent, entryText row.x, entryText row.y]))

private def scalarResults (field : Row → Entry) (rows : List Row) : List String :=
  let numeric := contributors field rows
  [numberText (sum numeric), (average numeric).elim "null" (fun f => numberText (.double f))]

private def matrix : List String := Id.run do
  let mut output := #[]
  for (dataset, docs) in datasets do
    for (target, x, y) in [("count", false, false), ("x", true, false), ("xy", true, true)] do
      for (cap, count) in [("none", none), ("zero", some 0), ("two", some 2)] do
        for (window, offset, limit) in [("all", 0, none), ("skip-take", 1, some 2), ("empty", 0, some 0)] do
          for (order, rank) in [("implicit", false), ("rank", true)] do
            let query := Request.mk x y rank offset limit count
            let chosen := selected query docs
            let values := [s!"i{countUpTo count chosen.length}"] ++
              (if x then scalarResults Row.x chosen else []) ++
              (if y then scalarResults Row.y chosen else [])
            output := output.push (String.intercalate "\t"
              [dataset, target, cap, window, order, datasetText docs, String.intercalate "," values])
  return output.toList

def main : IO Unit := do
  IO.println s!"# {matrix.length} cases."
  for row in matrix do IO.println row
