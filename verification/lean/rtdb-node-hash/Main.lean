import RtdbNodeHash
open RtdbNodeHash

def payloads : List (String × Leaf) :=
  [("false", .flag false), ("true", .flag true), ("text", .text "a:𐀀😀é"),
   ("zero", .number (.bits 0)), ("minusZero", .number (.bits 0x8000000000000000)),
   ("rounded", .number (.int 9007199254740993)), ("finiteMax", .number (.bits 0x7fefffffffffffff))]

def priorities : List (String × Option Priority) :=
  [("none", none), ("numeric", some (.number (.int 7))), ("text", some (.text ":parent:é"))]

def sampleChildren (leaf : Leaf) : List ChildRef :=
  let atNumber := some (Priority.number (.int (-3)))
  let atText := some (Priority.text "é")
  let grandchild := hashLeaf none (.text (String.ofList (List.replicate 65 'x')))
  [⟨"", 0, 9, hashLeaf none (.flag false)⟩,
   ⟨"z", 2, 10, hashParent atText [⟨"in", 0, 1, grandchild⟩]⟩,
   ⟨"2", 1, 2, hashLeaf atNumber (.flag true)⟩,
   ⟨"𐀀", 0, 8, hashLeaf none (.text "café")⟩,
   ⟨"01", 0, 1, hashLeaf none leaf⟩]

def main : IO Unit := do
  for shape in ["leaf", "parent", "selection", "empty"] do
    for (flag, priority) in priorities do
      for (kind, leaf) in payloads do
        let digest := match shape with
          | "leaf" => hashLeaf priority leaf
          | "parent" => hashParent priority (sampleChildren leaf)
          | "selection" => hashParent none (sampleChildren leaf)
          | _ => "-"
        IO.println <| "\t".intercalate [shape, flag, kind, digest]
