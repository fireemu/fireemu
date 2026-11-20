import RtdbServerValue
open RtdbServerValue

def operations : List (String × Operation) :=
  [("stamp", .timestamp), ("plus", .increment (.int 7)), ("minus", .increment (.int (-8))),
   ("float", .increment (.double 0xbfe0000000000000)),
   ("overflowFloat", .increment (.double 0x7fefffffffffffff)),
   ("negativeFloat", .increment (.double 0xffefffffffffffff)),
   ("negativeZero", .increment (.double 0x8000000000000000)),
   ("badOp", .malformed), ("extra", .malformed)]

def present : List (String × Option Number) :=
  [("absent", none), ("int", some (.int 11)), ("text", none), ("high", some (.int maxI64)),
   ("low", some (.int minI64)), ("float", some (.double 0x7fefffffffffffff)),
   ("negFloat", some (.double 0xffefffffffffffff)), ("negativeZero", some (.double 0x8000000000000000))]

def slots : List String := ["root", "object", "array", "value", "priority"]

def resultText : Option Number → String
  | none => "error"
  | some (.int n) => s!"i:{n}"
  | some (.double bits) => s!"d:{bits.toNat}"

def main : IO Unit := do
  for (action, op) in operations do
    for (kind, x) in present do
      for slot in slots do
        for now in ([-1001, 12345] : List Int) do
          IO.println <| "\t".intercalate [action, kind, slot, toString now, resultText (resolve op x now)]
