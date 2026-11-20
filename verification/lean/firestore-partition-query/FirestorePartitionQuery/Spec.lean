import Std

namespace FirestorePartitionQuery

structure Key where
  project : String
  database : String
  parts : List String
  deriving DecidableEq, Repr

def relative (key : Key) : String := String.intercalate "/" key.parts

def compareParts : List String → List String → Ordering
  | [], [] => .eq
  | [], _ => .lt
  | _, [] => .gt
  | a :: restA, b :: restB =>
    match compare a b with
    | .eq => compareParts restA restB
    | order => order

def compareKey (a b : Key) : Ordering :=
  match compare a.project b.project with
  | .eq =>
    match compare a.database b.database with
    | .eq => compareParts a.parts b.parts
    | order => order
  | order => order

def fnvStep (state : UInt64) (byte : UInt8) : UInt64 :=
  (state ^^^ UInt64.ofNat byte.toNat) * 0x0100000001b3

def fnv (bytes : List UInt8) : UInt64 :=
  bytes.foldl fnvStep 0xcbf29ce484222325

def keyHash (salt : String) (key : Key) : UInt64 :=
  fnv (salt.toUTF8.toList ++ (relative key).toUTF8.toList)

def sampled (key : Key) : Bool := keyHash "sample" key % 141 == 0

def priorityOrder (a b : Key) : Bool :=
  match compare (keyHash "priority" a) (keyHash "priority" b) with
  | .lt => true
  | .eq => compareKey a b != .gt
  | .gt => false

def keyOrder (a b : Key) : Bool := compareKey a b != .gt

def priorities (keys : List Key) : List Key := (keys.filter sampled).mergeSort priorityOrder

def cursors (keys : List Key) (count : Nat) : List Key :=
  ((priorities keys).take count).mergeSort keyOrder

end FirestorePartitionQuery
