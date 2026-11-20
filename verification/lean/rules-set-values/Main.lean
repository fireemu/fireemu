import RulesSetValues

open RulesSetValues

def text (s : Scalar) : String :=
  match s with
  | .integer v => s!"i:{v}"
  | .halfUnits v => s!"f:{v}"
  | .negativeZero => "negzero"
  | .nan => "nan"
  | .null => "null"
  | .bool true => "true"
  | .bool false => "false"
  | .string v => "s:" ++ v

def render (items : List Scalar) : String :=
  if items.isEmpty then "-" else String.intercalate "," (items.map text)

def families : List (String × List Scalar) :=
  [("empty", []),
   ("alias", [.integer 1, .halfUnits 2, .negativeZero, .halfUnits 0, .integer 0, .halfUnits (-1), .halfUnits 1]),
   ("neighbors", [.integer 9007199254740993, .halfUnits 18014398509481984,
     .integer 9223372036854775807, .halfUnits 18446744073709551616,
     .integer (-9223372036854775808), .halfUnits (-18446744073709551616)]),
   ("nan", [.nan, .halfUnits 2, .nan, .integer 1]),
   ("typed", [.string "1", .integer 1, .bool true, .null, .bool false, .string "0"])]

def expand (items : List Scalar) (left wide : Bool) : List Scalar :=
  if !wide then items else
    let count := if left then 72 else 10
    let start := if left then 100 else 164
    items ++ (List.range count).map (fun i => .integer (start + i))

def main : IO Unit := do
  IO.println "# 50 cases"
  for (leftName, rawLeft) in families do
    for (rightName, rawRight) in families do
      for wide in [false, true] do
        let left := expand rawLeft true wide
        let right := expand rawRight false wide
        let a := distinct left
        let b := distinct right
        let probe := rawRight.headD .nan
        let index := if wide then "wide" else "small"
        let fields := [leftName, rightName, index, render left, render right, text probe,
          toString a.length, toString b.length, toString (union a b).length,
          toString (intersection a b).length, toString (difference a b).length,
          toString (member probe a), toString (b.all fun item => member item a),
          toString (b.any fun item => member item a), toString (a.all fun item => member item b)]
        IO.println (String.intercalate "\t" fields)
