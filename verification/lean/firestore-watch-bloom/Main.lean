import FirestoreWatchBloom

open FirestoreWatchBloom

-- MD5 digests of the UTF-8 names, split into little-endian halves.
def names : List (String × (Nat × Nat)) :=
  [("alpha", (13789793986099222316, 18012544667999567158)),
   ("beta", (12870885432699288472, 10546340868891572416)),
   ("rain-é", (17130390889414176064, 14727465705785085131)),
   ("鳥🚀", (9062416969640976351, 1650941910780065767))]

def selections : List (String × List (String × (Nat × Nat))) :=
  [("none", []), ("one", names.take 1), ("two", names.take 2), ("three", names.drop 1),
   ("four", names), ("duplicate", names.take 1 ++ names.take 1), ("reverse", names.reverse)]

def emit (shape : String) (layout : Layout) (tag : String) (input : List (String × (Nat × Nat))) : IO Unit :=
  let labels := String.intercalate "," (input.map Prod.fst)
  let result := String.intercalate "," ((bitmap layout (input.map Prod.snd)).map toString)
  IO.println s!"{shape}|{layout.hashes}|{layout.bytes}|{layout.padding}|{tag}|{labels}|{result}"

def main : IO Unit := do
  IO.println "# mode|hashes|bytes|padding|shape|names|bitmap"
  for hashes in [-1, 0, 1, 3, 13] do
    for bytes in [0, 1, 3, 8] do
      for padding in [-1, 0, 3, 7, 8, 24, 64] do
        for (tag, input) in selections do
          emit "direct" ⟨hashes, bytes, padding⟩ tag input
  for (tag, input) in selections do
    match recorded input.length with
    | some layout => emit "recorded" layout tag input
    | none => IO.println s!"recorded|-|-|-|{tag}|{String.intercalate "," (input.map Prod.fst)}|-"
