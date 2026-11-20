import FirestoreFieldPath

open FirestoreFieldPath

private def hex (value : String) : String :=
  let alphabet := "0123456789abcdef".toList.toArray
  let chars := value.toUTF8.toList.flatMap fun b =>
    [alphabet[b.toNat / 16]!, alphabet[b.toNat % 16]!]
  String.ofList chars

private def faultCode : Fault → String
  | .empty => "empty"
  | .emptySegment i => s!"empty-segment:{i}"
  | .control i => s!"control:{i}"
  | .reserved i => s!"reserved:{i}"
  | .segmentBytes i b => s!"segment-bytes:{i}:{b}:{limit}"
  | .pathBytes b => s!"path-bytes:{b}:{limit}"

private def row (label segments : List String) : String :=
  let input := if segments.isEmpty then "-" else String.intercalate "," (segments.map hex)
  let output := match validate segments with
    | .ok () => ["ok:" ++ hex (canonical segments),
                hex (String.intercalate "." (segments.map fullyQuote))]
    | .error fault => [faultCode fault, "-"]
  String.intercalate "\t" (label ++ [input] ++ output)

private def fill (chunk : String) (length : Nat) : String :=
  chunk ++ String.ofList (List.replicate (length - chunk.utf8ByteSize) 'a')

private def matrix : List String := Id.run do
  let mut rows := #[]
  for (alphabet, start) in [("ascii", "Ab_9"), ("unicode", "é😀"),
      ("escaped", String.ofList ['a', tick, slash, '.'])] do
    for (bytes, count) in [("small", 12), ("boundary", 1500), ("over", 1501)] do
      for (shape, leading, remaining) in [("single", [], count), ("nested", ["p"], count - 2)] do
        rows := rows.push (row [alphabet, bytes, shape] (leading ++ [fill start remaining]))
  return rows.toList

private def additional : List (String × List String) :=
  [("empty-path", []), ("empty-segment", ["a", ""]), ("empty-head", ["", "b"]),
   ("reserved-head", ["__private__"]), ("reserved-tail", ["a", "____"]),
   ("document-name", ["__name__"]), ("document-name-as-segment", ["a", "__name__"]),
   ("control-local-offset", ["a", String.ofList ['é', Char.ofNat 133]]),
   ("control-over-limit", [String.ofList (Char.ofNat 0 :: List.replicate 1500 'a')]),
   ("reserved-over-limit", [ "__" ++ fill "é" 1497 ++ "__" ]),
   ("three-separators", ["a", "b", "c", fill "😀" 1494]),
   ("quote-two-segments", ["a.b", String.ofList [slash, tick, tick]])]

def main : IO Unit := do
  let rows := matrix ++ additional.map (fun (name, segments) => row ["extra", name, "raw"] segments)
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
