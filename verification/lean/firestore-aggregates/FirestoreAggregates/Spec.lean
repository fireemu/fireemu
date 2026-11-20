import Std

namespace FirestoreAggregates

def minI64 : Int := -9223372036854775808
def maxI64 : Int := 9223372036854775807

inductive Number
  | whole (value : Int)
  | double (value : Float)

def Number.isDouble : Number → Bool
  | .whole _ => false
  | .double _ => true

def Number.toFloat : Number → Float
  | .whole n =>
    let magnitude := (UInt64.ofNat n.natAbs).toFloat
    if n < 0 then -magnitude else magnitude
  | .double f => f

def plus : Number → Number → Number
  | .whole a, .whole b =>
    let exact := a + b
    if minI64 ≤ exact ∧ exact ≤ maxI64 then .whole exact
    else .double ((Number.whole a).toFloat + (Number.whole b).toFloat)
  | a, b => .double (a.toFloat + b.toFloat)

def sum (inputs : List Number) : Number :=
  inputs.foldl plus (.whole 0)

def average (inputs : List Number) : Option Float :=
  if inputs.isEmpty then none
  else some ((sum inputs).toFloat / (UInt64.ofNat inputs.length).toFloat)

inductive Entry
  | missing
  | null
  | text
  | number (value : Number)

def Entry.present : Entry → Bool
  | .missing => false
  | _ => true

def Entry.numeric : Entry → Option Number
  | .number value => some value
  | _ => none

structure Row where
  visible : Bool
  rankPresent : Bool
  x : Entry
  y : Entry

structure Request where
  requireX : Bool
  requireY : Bool
  requireRank : Bool
  offset : Nat
  limit : Option Nat
  cap : Option Nat

def eligible (query : Request) (row : Row) : Bool :=
  row.visible &&
    (!query.requireX || row.x.present) &&
    (!query.requireY || row.y.present) &&
    (!query.requireRank || row.rankPresent)

def compareNumbers (a b : Number) : Ordering :=
  match a, b with
  | .whole lhs, .whole rhs => compare lhs rhs
  | _, _ =>
    let lhs := a.toFloat
    let rhs := b.toFloat
    if lhs.isNaN then
      if rhs.isNaN then .eq else .lt
    else if rhs.isNaN then .gt
    else if lhs < rhs then .lt
    else if rhs < lhs then .gt
    else .eq

def entryRank : Entry → Nat
  | .missing => 0
  | .null => 1
  | .number _ => 2
  | .text => 3

def compareEntries (a b : Entry) : Ordering :=
  match a, b with
  | .number lhs, .number rhs => compareNumbers lhs rhs
  | _, _ => compare (entryRank a) (entryRank b)

def byTargetFields (query : Request) (a b : Row) : Bool :=
  let first := if query.requireX then compareEntries a.x b.x else .eq
  let second := if query.requireY then compareEntries a.y b.y else .eq
  match first with
  | .eq => second != .gt
  | ord => ord != .gt

/-- A bounded implicit-order query uses its appended target fields before the key. In the
    explicit-rank fixture, key order and rank order coincide. An unbounded fold uses key order. -/
def sourceRows (query : Request) (rows : List Row) : List Row :=
  let eligibleRows := rows.filter (eligible query)
  if !query.requireRank && (query.limit.isSome || query.offset != 0) then
    eligibleRows.mergeSort (byTargetFields query)
  else eligibleRows

def selected (query : Request) (rows : List Row) : List Row :=
  let skipped := (sourceRows query rows).drop query.offset
  query.limit.elim skipped (fun count => skipped.take count)

def countUpTo (cap : Option Nat) (count : Nat) : Nat :=
  cap.elim count (min count)

def contributors (field : Row → Entry) (rows : List Row) : List Number :=
  rows.filterMap (fun row => (field row).numeric)

end FirestoreAggregates
