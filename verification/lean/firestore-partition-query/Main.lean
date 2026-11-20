import FirestorePartitionQuery

open FirestorePartitionQuery

private def keyText (key : Key) : String :=
  s!"{key.project}:{key.database}:{relative key}"

private def generatedKeys (size : Nat) (shape : String) : List Key :=
  (List.range size).flatMap fun n =>
    let suffix := (if n % 4 = 0 then "é" else if n % 4 = 1 then "item" else "🐦") ++ toString n
    let pairs := if shape == "nested" then ["roots", "anchor" ++ toString (n % 3)] else []
    let key := Key.mk "demo-a" "(default)" (pairs ++ ["items", suffix])
    if shape == "namespaces" then
      [{ key with project := "demo-b" }, key, { key with database := "second" }, key]
    else [key]

private def csv (keys : List Key) : String :=
  if keys.isEmpty then "-" else String.intercalate "," (keys.map keyText)

private def matrix : List String := Id.run do
  let mut rows := #[]
  for (group, size) in [("empty", 0), ("small", 17), ("wide", 1600)] do
    for shape in ["root", "nested", "namespaces"] do
      let list := generatedKeys size shape
      let samples := (list.filter sampled).mergeSort keyOrder
      for (input, keys) in [("forward", list), ("reverse", list.reverse)] do
        for (limit, count) in [("zero", 0), ("one", 1), ("few", 7), ("all", 10000)] do
          rows := rows.push (String.intercalate "\t"
            [group, shape, input, limit, toString size, toString count, csv samples,
              csv (cursors keys count)])
  return rows.toList

def main : IO Unit := do
  IO.println s!"# {matrix.length} cases."
  for row in matrix do IO.println row
