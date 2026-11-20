import FirestoreTransforms

open FirestoreTransforms

private inductive Entry
  | missing
  | scalar (value : Scalar)
  | array (items : List Scalar)

private def scalarText : Scalar → String
  | .integer value => s!"i{value}"
  | .half units => s!"d{units}"
  | .negativeZero => "nzero"
  | .nan => "nan"
  | .positiveInf => "posinf"
  | .negativeInf => "neginf"
  | .text => "text"
  | .timestamp nanos => s!"t{nanos}"

private def entryText : Entry → String
  | .missing => "-"
  | .scalar value => scalarText value
  | .array items => "[" ++ String.intercalate "," (items.map scalarText) ++ "]"

private def operands : List (String × Scalar) :=
  [("zero", .integer 0), ("one", .integer 1), ("negative", .integer (-1)),
   ("high", .integer maxI64), ("low", .integer minI64), ("nzero", .negativeZero),
   ("half", .half 3), ("nan", .nan), ("posinf", .positiveInf),
   ("neginf", .negativeInf), ("precise", .half 18014398509481984), ("text", .text)]

private def currentValues : List (String × Entry) :=
  [("missing", .missing), ("text", .scalar .text), ("zero", .scalar (.integer 0)),
   ("high", .scalar (.integer maxI64)), ("low", .scalar (.integer minI64)),
   ("nzero", .scalar .negativeZero), ("half", .scalar (.half 3)), ("nan", .scalar .nan),
   ("posinf", .scalar .positiveInf), ("neginf", .scalar .negativeInf),
   ("precise", .scalar (.integer 9007199254740993))]

private def result (op : String) (current : Entry) (operand : Scalar) : String :=
  if !operand.numeric then "error"
  else
    let value := match op, current, operand with
      | "increment", .scalar (.integer n), .integer byAmount => Scalar.integer (increment n byAmount)
      | "increment", _, _ => operand
      | "maximum", .scalar existing, rhs => extremum true existing rhs
      | "minimum", .scalar existing, rhs => extremum false existing rhs
      | _, _, _ => operand
    scalarText value

private def numericMatrix : List String := Id.run do
  let mut rows := #[]
  for op in ["increment", "maximum", "minimum"] do
    for (current, input) in currentValues do
      for (operand, value) in operands do
        if op != "increment" ||
            (["missing", "text", "zero", "high", "low", "precise"].contains current &&
             ["zero", "one", "negative", "high", "low", "precise", "text"].contains operand) then
          let effective := if op == "increment" && operand == "precise" then Scalar.integer 9007199254740993
            else value
          for origin in ["prior", "same"] do
            rows := rows.push (String.intercalate "\t" ["number", op, current, operand, origin,
              entryText input, scalarText effective, result op input effective])
  return rows.toList

private def arrays : List (String × Entry) :=
  [("missing", .missing), ("text", .scalar .text), ("empty", .array []),
   ("duplicates", .array [.integer 1, .integer 1, .integer 2, .text]),
   ("numeric", .array [.integer 0, .negativeZero, .integer 2, .half 4, .nan]),
   ("timestamp", .array [.timestamp 7999, .timestamp 7001, .integer 7, .timestamp 8005])]

private def arrayOperands : List (String × List Scalar) :=
  [("empty", []), ("repetitions", [.integer 1, .integer 1, .integer 5, .integer 5]),
   ("equivalent", [.half 0, .half 4, .nan, .integer 8]),
   ("time-near", [.timestamp 7888, .timestamp 8001, .timestamp 9123]),
   ("distinct", [.integer (-2), .text, .positiveInf])]

private def arrayMatrix : List String := Id.run do
  let mut rows := #[]
  for op in ["union", "remove"] do
    for (current, input) in arrays do
      for (operands, items) in arrayOperands do
        for origin in ["prior", "same"] do
          let start := match input with
            | .array elements => elements.map normalized
            | _ => []
          let result := if op == "union" then appendMissing start items else removeAll start items
          rows := rows.push (String.intercalate "\t" ["array", op, current, operands, origin,
            entryText input, entryText (.array items), entryText (.array result)])
  return rows.toList

def main : IO Unit := do
  let rows := numericMatrix ++ arrayMatrix
  IO.println s!"# {rows.length} cases."
  for row in rows do IO.println row
