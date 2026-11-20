import FirestorePipelineValues

open FirestorePipelineValues

def operands : List (String × Operand) :=
  [("missing", .missing), ("null", .null), ("false", .boolean false), ("true", .boolean true),
    ("text", .text 1), ("text2", .text 2), ("nanA", .nan), ("nanB", .nan),
    ("negInf", .negInf), ("posInf", .posInf), ("i-1", .integer (-1)), ("i0", .integer 0),
    ("i1", .integer 1), ("i2", .integer 2), ("i9007199254740992", .integer 9007199254740992),
    ("i9007199254740993", .integer 9007199254740993),
    ("d-0", .doubleHalf 0), ("d0", .doubleHalf 0), ("d0.5", .doubleHalf 1),
    ("d1", .doubleHalf 2), ("d9007199254740992", .doubleHalf 18014398509481984)]

def comparisons : List (String × Comparison) :=
  [("equal", .eq), ("not_equal", .ne), ("less_than", .lt), ("less_than_or_equal", .le),
    ("greater_than", .gt), ("greater_than_or_equal", .ge)]

def arrays : List (String × List Operand) :=
  [("-", []), ("null", [.null]), ("false", [.boolean false]), ("d1", [.doubleHalf 2]),
    ("nanB,d-0", [.nan, .doubleHalf 0]), ("text,i2", [.text 1, .integer 2]),
    ("i9007199254740993", [.integer 9007199254740993]),
    ("d9007199254740992,negInf,posInf", [.doubleHalf 18014398509481984, .negInf, .posInf])]

def main : IO Unit := do
  IO.println "# KIND OP LEFT RIGHT EXPECTED, tab separated"
  for (op, comparison) in comparisons do
    for (left, a) in operands do
      for (right, b) in operands do
        IO.println ("\t".intercalate ["compare", op, left, right, toString (compareBy comparison a b)])
  for (left, a) in operands do
    for (right, vs) in arrays do
      for op in ["equal_any", "not_equal_any", "array_contains"] do
        let hit := contains a vs
        let answer := if op == "not_equal_any" then !hit else hit
        IO.println ("\t".intercalate ["membership", op, left, right, toString answer])
