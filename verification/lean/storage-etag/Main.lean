import StorageEtag

open StorageEtag

/-!
# Golden corpus

The count header is followed by TSV rows `kind generation metageneration etag`; bucket rows
use a hyphen for the absent generation. The two object values cross every base-128 boundary.
-/

def boundaryValues : List Nat :=
  [0, 1, 2, 3, 255, 256, 1790789164648913, 1791139765427541, 2 ^ 64 - 1] ++
  (List.range 9).flatMap fun i =>
    let n := 128 ^ (i + 1)
    [n - 1, n, n + 1]

def objectRow (g m : Nat) : String :=
  String.intercalate "\t" ["object", toString g, toString m, objectEtag g m]

def bucketRow (m : Nat) : String :=
  String.intercalate "\t" ["bucket", "-", toString m, bucketEtag m]

def main : IO Unit := do
  let rows := boundaryValues.map bucketRow ++
    (boundaryValues.flatMap fun g => boundaryValues.map (objectRow g))
  IO.println s!"# {rows.length}"
  rows.forM IO.println
