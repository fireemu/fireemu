import Std

namespace FirestorePipelineValues

/-- Finite represented doubles in this model have an exact integer number of half-units.
    The exponent range and representability constraints belong to corpus construction. -/
inductive Operand where
  | missing | null | boolean (b : Bool) | integer (i : Int) | doubleHalf (units : Int)
  | negInf | posInf | nan | text (value : Nat)
  deriving DecidableEq, Repr

/-- A domain and its order coordinate. Distinct finite numeric representations share the
    same domain, but NaN, missing and null each occupy a separate domain. -/
def key : Operand → Nat × Int × Int
  | .missing => (0, 0, 0)
  | .null => (1, 0, 0)
  | .boolean b => (2, 0, if b then 1 else 0)
  | .nan => (3, 0, 0)
  | .negInf => (4, -1, 0)
  | .integer i => (4, 0, i * 2)
  | .doubleHalf units => (4, 0, units)
  | .posInf => (4, 1, 0)
  | .text ordinal => (5, 0, ordinal)

def equivalent (a b : Operand) : Bool := decide (key a = key b)

def order (a b : Operand) : Option Ordering :=
  let ka := key a
  let kb := key b
  if ka.1 ≠ kb.1 then none
  else if ka = kb then some .eq
  else if ka.2.1 < kb.2.1 || (ka.2.1 == kb.2.1 && ka.2.2 < kb.2.2) then some .lt
  else some .gt

inductive Comparison where
  | eq | ne | lt | le | gt | ge
  deriving DecidableEq, Repr

def compareBy (op : Comparison) (a b : Operand) : Bool :=
  let o := order a b
  match op with
  | .eq => o == some .eq
  | .ne => o != some .eq
  | .lt => o == some .lt
  | .le => o == some .lt || o == some .eq
  | .gt => o == some .gt
  | .ge => o == some .gt || o == some .eq

/-- Missing is outside the domain of ordinary array elements, while explicit null is a value. -/
def contains (wanted : Operand) (values : List Operand) : Bool :=
  wanted != .missing && values.any (equivalent wanted)

end FirestorePipelineValues
