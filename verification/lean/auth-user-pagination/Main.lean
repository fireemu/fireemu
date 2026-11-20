import AuthUserPagination

open AuthUserPagination

private def users : List User :=
  [ ⟨"g", some "Alpha", some "g@x.test", none, 3000100, some 0⟩
  , ⟨"f", some "Zed", some "f@x.test", none, 3000000, some 9000000⟩
  , ⟨"e", some "other", none, none, 0, some (-999999)⟩
  , ⟨"d", some "Alpha", some "d@x.test", some "+12025550111", 1000000, some 1999999⟩
  , ⟨"c", some "same", some "c@x.test", none, 1999999, some 1000000⟩
  , ⟨"b", none, none, none, -1999999, some 1999999⟩
  , ⟨"a", some "same", some "a@x.test", none, -2500000, none⟩ ]

private def filters : List (String × List Predicate) :=
  [("all", []), ("miss", [.uid "A"]),
   ("overlap", [.uid "a", .uid "b", .email "A@X.TEST", .phone "+12025550111", .uid "b"]),
   ("case", [.email "G@X.tEsT"]), ("phone", [.phone "+12025550111"])]

private def tagBound (value : String) : Nat :=
  if value == "max" then users.length + 1 else value.toNat?.getD 0

def main : IO Unit := do
  let mut rows := #[]
  let fields : List (String × Field) :=
    [("id", .uid), ("name", .name), ("email", .email), ("created", .created), ("login", .login)]
  for (label, field) in fields do
    for (direction, desc) in [("asc", false), ("desc", true)] do
      for (group, predicates) in filters do
        for offset in ["0", "1", "3", "7", "max"] do
          for limit in ["0", "1", "2", "5", "max"] do
            let count := (matching predicates users).length
            let expected := page field desc predicates (tagBound offset) (tagBound limit) users
            let text := if expected.isEmpty then "-" else String.intercalate "," (expected.map User.uid)
            rows := rows.push s!"page {label} {direction} {group} {offset} {limit} {count} {text}"
  IO.println s!"# cases {rows.size}"
  for row in rows do IO.println row
