import Std

namespace SI

abbrev Path := List String

def name : Path := ["__name__"]

inductive Direction where
  | asc | desc
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr, Inhabited

def Direction.flip : Direction → Direction
  | .asc => .desc
  | .desc => .asc

@[simp] theorem Direction.flip_flip (d : Direction) : d.flip.flip = d := by cases d <;> rfl

inductive Mode where
  | ordered (dir : Direction)
  | contains
  | vector (dimension : Nat)
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

def Mode.flip : Mode → Mode
  | .ordered d => .ordered d.flip
  | m => m

@[simp] theorem Mode.flip_flip (m : Mode) : m.flip.flip = m := by cases m <;> simp [Mode.flip]

abbrev Field := Path × Mode
abbrev Clause := Path × Direction

def key (dir : Direction) : Field := (name, .ordered dir)

structure Requirement where
  equality : List Path
  array : Option Path
  order : List Clause
  equalityOrdered : Bool := false
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

inductive Scope where
  | collection | group
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr, Inhabited

structure Index where
  collection : String
  scope : Scope
  fields : List Field
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

inductive Policy where
  | production | report | emulator
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

inductive Edition where
  | standard | enterprise
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

/-- The equality prefix restricts ordered keys to fixed values; directions on the
fixed keys have no effect on document order. Membership is a distinct restriction,
on an index entry for an array element. The remaining keys vary lexicographically,
with the unique document name breaking ties. These are symbolic observations of
one bounded scan, for arbitrary values and documents with indexed fields present.
The scan includes no post-filter, second scan, or resort. Requirement extraction
coalesces repeated query equality paths. A name appearing before another varying
key makes the latter unobservable and is outside this normal form. -/
def FixedKeys (fixed : List Field) (eqs : List Path) : Prop :=
  fixed.length = eqs.length ∧
  (∀ p, p ∈ fixed.map Prod.fst ↔ p ∈ eqs) ∧
  (∀ f ∈ fixed, ∃ d, f.2 = Mode.ordered d)

def varyingKeys (order : List Clause) : List Field :=
  order.map fun o => (o.1, .ordered o.2)

def arrayKeys (array : Option Path) : List Field :=
  array.toList.map (·, Mode.contains)

def implicitTie (fields : List Field) : Direction :=
  (fields.reverse.findSome? fun f =>
    match f.2 with | .ordered d => some d | _ => none).getD .asc

def ScanKeys (fields : List Field) (equalities : List Path) (array : Option Path)
    (order : List Clause) (tie : Direction) : Prop :=
  ∃ fixed suffix,
    fields = fixed ++ arrayKeys array ++ varyingKeys order ++ suffix ∧
    FixedKeys fixed equalities ∧
    (∀ o ∈ order, o.1 ≠ name) ∧
    (suffix = [key tie] ∨
      (suffix = [] ∧ tie = implicitTie (fixed ++ arrayKeys array ++ varyingKeys order)))

/-- A scan must cover the collection and the requested scope as well as the keys. -/
def Serves (i : Index) (coll : String) (scope : Scope) (eqs : List Path)
    (arr : Option Path) (order : List Clause) (tie : Direction) : Prop :=
  i.collection = coll ∧ i.scope = scope ∧ ScanKeys i.fields eqs arr order tie

def CanCreate (i : Index) : Prop :=
  i.fields.length ≤ 100 ∧ (i.fields.filter (fun f => f.2 == .contains)).length ≤ 1 ∧
  (2 ≤ i.fields.length ∨ (∃ f ∈ i.fields, f.1 = name) ∨
    ∃ f ∈ i.fields, ∃ dimension, f.2 = .vector dimension)

/-- One automatic slot supplies one kind of key. An equality may use either
ordered mode; a varying key must also have the requested implicit name direction.
Mode availability is separate and refers to the query's exact scope. -/
def AutomaticMode (p : Path) (m : Mode) (eqs : List Path)
    (arr : Option Path) (order : List Clause) (tie : Direction) : Prop :=
  match m with
  | .contains => arr = some p ∧ eqs = [] ∧ order = []
  | .ordered d => arr = none ∧
      ((eqs = [p] ∧ order = []) ∨ (eqs = [] ∧ order = [(p, d)] ∧ d = tie))
  | .vector _ => False

/-- Values are abstract ranks. Equality uses a rank for the entire value; array
elements are observed separately. The name key has a distinct rank per document
within a scan. -/
structure Document where
  value : Path → Nat
  elements : Path → List Nat

def matchesQuery (d : Document) (eqs : List Path) (arr : Option Path)
    (value : Path → Nat) (element : Nat) : Prop :=
  (∀ p ∈ eqs, d.value p = value p) ∧
  (∀ p, arr = some p → element ∈ d.elements p)

def lexCompare (fields : List Field) (left right : Document) : Ordering :=
  match fields with
  | [] => .eq
  | (p, m) :: rest =>
    let next := lexCompare rest left right
    match m with
    | .ordered dir =>
      let x := left.value p
      let y := right.value p
      match (if dir == .asc then compare x y else compare y x) with
      | .eq => next
      | unequal => unequal
    | _ => next

end SI
