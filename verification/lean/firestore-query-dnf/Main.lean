import FirestoreQueryDnf

open FirestoreQueryDnf

private def renderArgument : Argument → String
  | .literal value => value
  | .array members => "[" ++ String.intercalate "," members ++ "]"

private def renderOp : Op → String
  | .equal => "e"
  | .inList => "i"
  | .containsAny => "a"
  | .notIn => "n"

private def renderAtom : Atom → String
  | .isNull field => s!"u:{field}"
  | .comparison field op argument => s!"{renderOp op}:{field}:{renderArgument argument}"

private structure Program where
  semantics : Expression
  commands : List String

private def leaf (value : Atom) : Program :=
  ⟨.atom value, [renderAtom value]⟩

private def and (children : List Program) : Program :=
  ⟨children.foldr (fun child rest => .both child.semantics rest) .unconstrained,
   children.flatMap Program.commands ++ [s!"A{children.length}"]⟩

private def or (children : List Program) : Program :=
  ⟨children.foldr (fun child rest => .either child.semantics rest) .impossible,
   children.flatMap Program.commands ++ [s!"O{children.length}"]⟩

private def equal (field value : String) : Program :=
  leaf (.comparison field .equal (.literal value))

private def member (field : String) (operator : Op) (choices : List String) : Program :=
  leaf (.comparison field operator (.array choices))

private def branches (terms : Dnf) : String :=
  if terms.isEmpty then "zero"
  else String.intercalate "|" (terms.map fun term =>
    if term.isEmpty then "_" else String.intercalate " " (term.map renderAtom))

private def componentText (count : Components) : String :=
  s!"{count.filters}:{count.orders}:{count.parentPath}:{count.total}"

private def row (composition atom orderLabel parent : String) (query : Option Program) (orders : Nat)
    (replayBranches : Bool := true) (replayComponents : Bool := true) : String :=
  let expression := (query.map Program.semantics).getD .unconstrained
  let commands := (query.map (fun program => String.intercalate " " program.commands)).getD "-"
  let dnf := if replayBranches then branches (materialize expression) else "-"
  let breakdown := if replayComponents then componentText (componentCount expression orders
    (parent != "root")) else "-"
  String.intercalate "\t" [composition, atom, orderLabel, parent, commands, toString orders,
    toString (disjunctionCount expression), breakdown, dnf]

private def atoms : List (String × Program) :=
  [("equal", equal "a" "5"),
   ("unary", leaf (.isNull "a")),
   ("in", member "a" .inList ["3", "-1", "3", "null", "[0,[2]]"]),
   ("any", member "a" .containsAny ["null", "2", "2", "[3,1]"]),
   ("not-in", member "a" .notIn ["1", "null", "1"]),
   ("malformed-in", leaf (.comparison "a" .inList (.literal "-4"))),
   ("malformed-any", leaf (.comparison "a" .containsAny (.literal "null"))),
   ("empty-in", member "a" .inList []),
   ("empty-any", member "a" .containsAny [])]

private def matrix : List String := Id.run do
  let mut rows := #[]
  let first := equal "b" "1"
  let second := equal "b" "2"
  let also := leaf (.isNull "c")
  for (name, value) in atoms do
    for (composition, query) in [
        ("leaf", value),
        ("union", or [value, first, value]),
        ("product", and [or [first, second], value, also])] do
      for (orderLabel, orderCount) in [("none", 0), ("explicit", 2)] do
        for parent in ["root", "shallow", "deep"] do
          rows := rows.push (row composition name orderLabel parent (some query) orderCount)
  return rows.toList

private def boundaryRows : List String :=
  let low := member "a" .inList (List.range 64 |>.map toString)
  let high := member "b" .containsAny (List.range 64 |>.map toString)
  let exactly := and [low, high]
  let choice := member "x" .inList ["0", "1"]
  let twoTo63 := and (List.replicate 63 choice)
  let twoTo64 := and (List.replicate 64 choice)
  let equality := equal "z" "0"
  let absent := or []
  [row "boundary" "missing" "none" "root" none 0,
   row "boundary" "missing" "explicit" "deep" none 3,
   row "boundary" "empty-and" "none" "root" (some (and [])) 0,
   row "boundary" "empty-or" "none" "shallow" (some absent) 0,
   row "boundary" "neutral-left" "none" "root" (some (and [and [], equality])) 0,
   row "boundary" "neutral-right" "none" "root" (some (and [equality, and []])) 0,
   row "boundary" "empty-left" "none" "root" (some (and [absent, equality])) 0,
   row "boundary" "empty-right" "none" "root" (some (and [equality, absent])) 0,
   row "boundary" "empty-union" "explicit" "root" (some (or [absent, and [], equality])) 1,
   row "boundary" "exact-materialization-limit" "explicit" "shallow" (some exactly) 2,
   row "boundary" "above-materialization-limit" "explicit" "deep"
     (some (or [exactly, equality])) 2 false,
   row "boundary" "large-exact-product" "none" "root" (some twoTo63) 0 false,
   row "boundary" "saturated-product" "none" "root" (some twoTo64) 0 false,
   row "boundary" "saturated-sum" "explicit" "root" (some (or [twoTo63, twoTo63])) 2 false,
   row "boundary" "zero-after-saturation" "none" "root"
     (some (and [twoTo64, absent])) 0 false false]

def main : IO Unit := do
  let rows := matrix ++ boundaryRows
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
