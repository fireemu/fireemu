import Std

namespace FirestoreQueryDnf

inductive Op
  | equal
  | inList
  | containsAny
  | notIn

/-- Each member is an opaque complete value. Only the outer array is inspected. -/
inductive Argument
  | literal (value : String)
  | array (items : List String)

inductive Atom
  | comparison (field : String) (operator : Op) (argument : Argument)
  | isNull (field : String)

inductive Expression
  | atom (value : Atom)
  | unconstrained
  | impossible
  | both (left right : Expression)
  | either (left right : Expression)

abbrev Term := List Atom
abbrev Dnf := List Term

def alternatives : Atom → List Atom
  | .comparison field .inList (.array values) =>
    values.map fun value => .comparison field .equal (.literal value)
  | .comparison field .containsAny (.array values) =>
    values.map fun value => .comparison field .containsAny (.array [value])
  | value => [value]

/-- Left-major Cartesian product, retaining atom order in each concatenated term. -/
def product (left right : Dnf) : Dnf :=
  left.flatMap fun a => right.map fun b => a ++ b

def materialize : Expression → Dnf
  | .atom value => (alternatives value).map fun atom => [atom]
  | .unconstrained => [[]]
  | .impossible => []
  | .both left right => product (materialize left) (materialize right)
  | .either left right => materialize left ++ materialize right

/-- Two independent symbolic quantities, with arbitrary-precision natural arithmetic. -/
structure Statistics where
  disjunctions : Nat
  occurrences : Nat
  deriving DecidableEq, Repr

def statistics : Expression → Statistics
  | .atom atom =>
    let count := (alternatives atom).length
    ⟨count, count⟩
  | .unconstrained => ⟨1, 0⟩
  | .impossible => ⟨0, 0⟩
  | .both left right =>
    let a := statistics left
    let b := statistics right
    ⟨a.disjunctions * b.disjunctions,
     a.occurrences * b.disjunctions + a.disjunctions * b.occurrences⟩
  | .either left right =>
    let a := statistics left
    let b := statistics right
    ⟨a.disjunctions + b.disjunctions, a.occurrences + b.occurrences⟩

def occurrences (terms : Dnf) : Nat :=
  (terms.map List.length).sum

def maxCount : Nat := 18446744073709551615
def materializationLimit : Nat := 4096

def disjunctionCount (expr : Expression) : Nat :=
  min maxCount (statistics expr).disjunctions

/-- The bounded fold corresponding to the Rust count operations. -/
def saturatedFold : Expression → Nat
  | .atom atom => min maxCount (alternatives atom).length
  | .unconstrained => 1
  | .impossible => 0
  | .both left right => min maxCount (saturatedFold left * saturatedFold right)
  | .either left right => min maxCount (saturatedFold left + saturatedFold right)

structure Components where
  filters : Nat
  orders : Nat
  parentPath : Nat
  deriving DecidableEq, Repr

def Components.total (size : Components) : Nat :=
  size.filters + size.orders + size.parentPath

def componentCount (expr : Expression) (orders : Nat) (parent : Bool) : Components :=
  let stats := statistics expr
  let filters := if materializationLimit < stats.disjunctions then maxCount / 4
    else stats.occurrences
  ⟨filters, orders, if parent then 1 else 0⟩

end FirestoreQueryDnf
