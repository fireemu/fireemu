import RtdbLongPoll
open RtdbLongPoll

def cases : List (String × List Segment) :=
  let next := ⟨2, 1, "bmV4dA=="⟩
  [("paired", [⟨0, 2, "aG"⟩, ⟨1, 99, "VsbG8="⟩, next]),
   ("single", [⟨0, 1, "aGk="⟩, ⟨1, 1, "bmV4dA=="⟩]),
   ("empty", [⟨0, 0, ""⟩, ⟨1, 1, "bmV4dA=="⟩]),
   ("malformed", [⟨0, 2, "aG"⟩, ⟨1, 2, "!"⟩, next]),
   ("unicode", [⟨0, 2, "8J"⟩, ⟨1, 2, "-YgA.."⟩, next]),
   ("invalidUtf8", [⟨0, 1, "_w.."⟩, ⟨1, 1, "bmV4dA=="⟩]),
   ("overflow", [⟨0, 1, ""⟩, ⟨1, 18446744073709551615, ""⟩])]

def arrival (name : String) (segments : List Segment) : List (List Segment) :=
  let first := segments[0]!
  let second := segments[1]!
  let repeated := "aGhpYWdhaW4="
  match name with
  | "ordered" => [segments]
  | "reversed" => segments.reverse.map List.singleton
  | "split" => segments.map List.singleton
  | _ => [segments.drop 1, [{ second with body := repeated }], [first], [{ first with body := repeated }]]

def replies (bounds : Bounds) (state : State) : List (List Segment) → List String
  | [] => []
  | request :: tail =>
    match receive bounds state request with
    | .error _ => ["bad"]
    | .ok (next, messages) =>
      let result := if messages.isEmpty then "ok" else "ok:" ++ ",".intercalate messages
      result :: replies bounds next tail

def renderRequest (request : List Segment) : String :=
  "|".intercalate (request.map fun s => s!"{s.number},{s.total},{s.body}")

def main : IO Unit := do
  let caps : List (String × Bounds) :=
    [("roomy", ⟨128, 8⟩), ("byteBound", ⟨8, 8⟩), ("segmentBound", ⟨128, 1⟩)]
  for shape in ["ordered", "reversed", "split", "duplicate"] do
    for (cap, bounds) in caps do
      for (kind, segments) in cases do
        let requests := arrival shape segments
        let batch := ";".intercalate (requests.map renderRequest)
        let expected := ";".intercalate (replies bounds ⟨0, []⟩ requests)
        IO.println <| "\t".intercalate [shape, cap, kind, toString bounds.bytes, toString bounds.count, batch, expected]
