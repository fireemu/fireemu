import Std

namespace FirestoreTransforms

def minI64 : Int := -9223372036854775808
def maxI64 : Int := 9223372036854775807

def increment (value operand : Int) : Int :=
  max minI64 (min maxI64 (value + operand))

/-- Binary64 finite witness values are exact multiples of 1/2. -/
inductive Scalar
  | integer (value : Int)
  | half (units : Int)
  | negativeZero
  | nan
  | positiveInf
  | negativeInf
  | text
  | timestamp (nanos : Nat)
  deriving DecidableEq

def Scalar.numeric : Scalar → Bool
  | .timestamp _ | .text => false
  | _ => true

def Scalar.isNan : Scalar → Bool
  | .nan => true
  | _ => false

/-- Type and exact value of one element after the timestamp storage quotient. -/
def canonicalKey : Scalar → Nat × Int
  | .nan => (0, 0)
  | .negativeInf => (1, 0)
  | .integer value => (2, 2 * value)
  | .half units => (2, units)
  | .negativeZero => (2, 0)
  | .positiveInf => (3, 0)
  | .timestamp nanos => (4, Int.ofNat (nanos / 1000))
  | .text => (5, 0)

def normalized : Scalar → Scalar
  | .timestamp nanos => .timestamp (nanos / 1000 * 1000)
  | ordinary => ordinary

def extremum (maximum : Bool) (current operand : Scalar) : Scalar :=
  if !current.numeric then operand
  else if current.isNan then current
  else if operand.isNan then operand
  else
    let (ar, av) := canonicalKey current
    let (br, bv) := canonicalKey operand
    if (maximum && (ar < br || (ar == br && av < bv))) ||
       (!maximum && (br < ar || (ar == br && bv < av))) then operand else current

def contains (items : List Scalar) (value : Scalar) : Bool :=
  items.any (fun item => canonicalKey value == canonicalKey item)

def appendMissing (current : List Scalar) : List Scalar → List Scalar
  | [] => current
  | item :: tail =>
    if contains current item then appendMissing current tail
    else appendMissing (current ++ [normalized item]) tail

def removeAll (current operands : List Scalar) : List Scalar :=
  current.filter (fun item => !contains operands item)

end FirestoreTransforms
