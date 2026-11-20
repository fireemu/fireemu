import Std

namespace FirestoreProtoValues

inductive Verdict where
  | same | null | missing | unsupported | map | vector | badVector
  | reservedName | integerType | reservedType | negativeNanos | rangeNanos | rangeSeconds
  | badGeo | depth
  deriving Repr, DecidableEq

inductive Marker where
  | absent | exact | other | integer
  deriving Repr, DecidableEq

inductive Payload where
  | empty | doubles | mixed | bad | scalar
  deriving Repr, DecidableEq

inductive Extra where
  | absent | ordinary | name
  deriving Repr, DecidableEq

/-- An exact vector sentinel requires the marker, an array, and no extra field. Fallback
    map validation uses key order, so the reserved name precedes the reserved type key. -/
def mapVerdict (marker : Marker) (payload : Payload) : Extra → Verdict
  | .name => .reservedName
  | extra =>
    if marker = .exact ∧ payload ≠ .scalar ∧ extra = .absent then
      if payload = .bad then .badVector else .vector
    else
      match marker with
      | .absent => .map
      | .integer => .integerType
      | _ => .reservedType

def minSeconds : Int := -62135596800
def maxSeconds : Int := 253402300799
def nanosPerSecond : Int := 1000000000

def timestamp (seconds nanos : Int) : Verdict :=
  if nanos < 0 then .negativeNanos
  else if nanosPerSecond ≤ nanos then .rangeNanos
  else if minSeconds ≤ seconds ∧ seconds ≤ maxSeconds then .same
  else .rangeSeconds

def inRange (coordinate : Option Int) (bound : Int) : Bool :=
  coordinate.any fun n => decide (-bound ≤ n ∧ n ≤ bound)

/-- The finite corpus uses integral coordinates. None also represents non-finite floats. -/
def geo (latitude longitude : Option Int) : Verdict :=
  if inRange latitude 90 && inRange longitude 180 then .same else .badGeo

/-- The count is of ordinary maps and arrays. A recognized vector sentinel is a leaf even
    though its protobuf representation contains a map and an array. -/
def container (ordinaryDepth : Nat) : Verdict :=
  if ordinaryDepth ≤ 20 then .same else .depth

end FirestoreProtoValues
