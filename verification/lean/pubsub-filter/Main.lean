import PubSubFilter

open PubSubFilter

def values : List (String × Option String) :=
  [("absent", none), ("empty", some ""), ("blue", some "blue"), ("prefix", some "blue-1"),
   ("case", some "Blue"), ("unicode", some "日本"), ("quoted", some "a\"b\\c")]

def attrs (left right : Option String) : Attributes :=
  fun key => if key == "a" then left else if key == "b.with.dot" then right else none

def quote (s : String) : String :=
  "\"" ++ String.ofList (s.toList.flatMap fun c =>
    if c == '"' || c == '\\' then ['\\', c] else [c]) ++ "\""

def wire : Expr → String
  | .exists key => "attributes:" ++ quote key
  | .equal key value => "attributes." ++ quote key ++ " = " ++ quote value
  | .unequal key value => "attributes." ++ quote key ++ " != " ++ quote value
  | .prefix key value => "hasPrefix(attributes." ++ quote key ++ ", " ++ quote value ++ ")"
  | .neg expr => "NOT (" ++ wire expr ++ ")"
  | .both left right => "(" ++ wire left ++ ") AND (" ++ wire right ++ ")"
  | .either left right => "(" ++ wire left ++ ") OR (" ++ wire right ++ ")"

def truth (b : Bool) : String := if b then "yes" else "no"

def families : List (String × Expr) :=
  let a := Expr.exists "a"
  let b := Expr.exists "b.with.dot"
  [("exists", a), ("eq", .equal "a" "blue"), ("ne", .unequal "a" "blue"),
   ("prefix", .prefix "a" "blue"), ("empty-prefix", .prefix "a" ""),
   ("not", .neg a), ("and", .both a b), ("or", .either a b),
   ("quoted", .equal "b.with.dot" "a\"b\\c"), ("unicode", .prefix "b.with.dot" "日"),
   ("empty-value", .equal "a" ""), ("nested", .neg (.either a (.both b (.neg a)))),
   ("right-neq", .unequal "b.with.dot" ""), ("combined", .either a (.both b (.neg a))),
   ("mixed-precedence", .either a (.both b (.neg (.equal "a" "blue"))))]

def source (family : String) (expr : Expr) : String :=
  if family == "mixed-precedence" then "attributes:a oR attributes:\"b.with.dot\" aNd nOt attributes.a = \"blue\""
  else wire expr

def padding (n : Nat) := String.ofList (List.replicate n ' ')

def wireCases : List (String × String) :=
  [("", "yes"), (padding 256, "yes"), (padding 257, "size"),
   ("attributes:a" ++ padding (256 - "attributes:a".utf8ByteSize), "no"),
   ("attributes:a" ++ padding (257 - "attributes:a".utf8ByteSize), "size"),
   ("attributes.a == \"blue\"", "invalid")]

def points (s : String) : String :=
  if s.isEmpty then "-" else String.intercalate "," (s.toList.map (toString ∘ Char.toNat))

def main : IO Unit := do
  IO.println s!"# {values.length * values.length * families.length + wireCases.length}"
  for (lc, left) in values do
    for (rc, right) in values do
      for (family, expr) in families do
        IO.println (String.intercalate "\t"
          [lc, rc, family, truth (eval (attrs left right) expr), points (source family expr)])
  for (input, accepted) in wireCases do
    IO.println (String.intercalate "\t" ["absent", "absent", "wire", accepted, points input])
