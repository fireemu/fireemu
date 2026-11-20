import Std

namespace FirestoreQueryScope

abbrev Pair := String × String
abbrev Path := List Pair

/-- Strip an anchor by matching its collection and document identifiers in order. -/
def remainder : Path → Path → Option Path
  | [], path => some path
  | _ :: _, [] => none
  | p :: ps, q :: qs => if p = q then remainder ps qs else none

inductive Reach
  | direct
  | descendants
  deriving DecidableEq, Repr

/-- A named selector matches the innermost collection, regardless of the intermediate pairs. -/
def describes (reach : Reach) (collection : Option String) (suffix : Path) : Bool :=
  match reach, suffix with
  | _, [] => false
  | .direct, [first] => collection.all (· == first.1)
  | .direct, _ => false
  | .descendants, first :: tail => collection.all (· == (tail.getLast?.getD first).1)

/-- An empty anchor denotes the database root. Project and database IDs are deliberately absent. -/
def contains (reach : Reach) (collection : Option String) (anchor path : Path) : Bool :=
  (remainder anchor path).any (describes reach collection)

end FirestoreQueryScope
