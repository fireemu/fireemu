import Std

namespace DS

/-- Size-relevant parts of a Firestore value. Counts model the lengths of bytes and vectors. Maps have distinct keys and are supplied in byte order for document breakdowns. -/
inductive Value
  | null
  | boolean (value : Bool)
  | integer
  | double
  | timestamp
  | string (value : String)
  | bytes (length : Nat)
  | reference (resourceName : String)
  | geoPoint
  | array (items : List Value)
  | vector (length : Nat)
  | map (entries : List (String × Value))
  deriving Inhabited

abbrev Fields := List (String × Value)
abbrev Path := List String

/-- The sole Rust error, `SizeError::Overflow`, is represented by `none`. -/
abbrev Size := Option Nat

def maxU64 : Nat := 18446744073709551615

def checked (n : Nat) : Size := if n ≤ maxU64 then some n else none

def add (a b : Nat) : Size := checked (a + b)

def addSizes (a b : Size) : Size := do add (← a) (← b)

def stringBytes (s : String) : Nat := s.utf8ByteSize + 1

def stringSize (s : String) : Size :=
  addSizes (checked s.utf8ByteSize) (some 1)

def segmentBytes : Path → Nat
  | [] => 0
  | s :: ss => stringBytes s + segmentBytes ss

def segmentSize : Path → Size
  | [] => some 0
  | s :: ss => addSizes (stringSize s) (segmentSize ss)

def documentNameSize (path : Path) : Size := addSizes (some 16) (segmentSize path)

/-- Consume the first occurrence of a delimiter, preserving everything after it. -/
def afterDelimiter (separator : List Char) : List Char → Option (List Char)
  | [] => none
  | c :: rest =>
    match separator.isPrefixOf? (c :: rest) with
    | some suffix => some suffix
    | none => afterDelimiter separator rest

def referencePath (name : String) : Path :=
  let raw := name.toList
  let relative := do
    let project ← "projects/".toList.isPrefixOf? raw
    let database ← afterDelimiter "/databases/".toList project
    afterDelimiter "/documents/".toList database
  ((relative.getD raw).splitOn '/').map String.ofList

def referenceSize (name : String) : Size := documentNameSize (referencePath name)

/-! Unbounded byte charges, independent of the checked calculator. -/
mutual
def valueBytes : Value → Nat
  | .null | .boolean _ => 1
  | .integer | .double | .timestamp => 8
  | .geoPoint => 16
  | .string s => stringBytes s
  | .bytes n => n
  | .reference s => 16 + segmentBytes (referencePath s)
  | .array items => arrayBytes items
  | .vector n => n * 8
  | .map fields => fieldsBytes fields

def arrayBytes : List Value → Nat
  | [] => 0
  | v :: vs => valueBytes v + arrayBytes vs

def fieldsBytes : Fields → Nat
  | [] => 0
  | (k, v) :: fs => stringBytes k + valueBytes v + fieldsBytes fs
end

mutual
def fieldValueSize : Value → Size
  | .null | .boolean _ => some 1
  | .integer | .double | .timestamp => some 8
  | .geoPoint => some 16
  | .string s => stringSize s
  | .bytes n => checked n
  | .reference s => referenceSize s
  | .array items => arraySize items
  | .vector n => do checked ((← checked n) * 8)
  | .map fields => fieldsSize fields

def arraySize : List Value → Size
  | [] => some 0
  | v :: vs => addSizes (fieldValueSize v) (arraySize vs)

def fieldsSize : Fields → Size
  | [] => some 0
  | (k, v) :: fs => addSizes (addSizes (stringSize k) (fieldValueSize v)) (fieldsSize fs)
end

structure Breakdown where
  total : Nat
  nameBytes : Nat
  largestContributors : List (String × Nat)
  modelRevision : String := "firestore-storage-size-2026-09-23-reference-index"
  precision : String := "BoundaryConformance"
  deriving Inhabited

/-- The Rust insertion keeps earlier fields first on ties and retains at most ten. -/
def largestContributors (fields : Fields) : List (String × Nat) :=
  fields.foldl (fun acc (k, v) =>
    let bytes := stringBytes k + valueBytes v
    let (before, after) := acc.span (fun entry => entry.2 ≥ bytes)
    (before ++ (k, bytes) :: after).take 10) []

def documentSize (path : Path) (fields : Fields) : Option Breakdown := do
  let nameBytes ← documentNameSize path
  let total ← addSizes (add nameBytes 32) (fieldsSize fields)
  return { total, nameBytes, largestContributors := largestContributors fields }

def documentBytes (path : Path) (fields : Fields) : Nat :=
  16 + segmentBytes path + 32 + fieldsBytes fields

def indexedCharge (v : Value) (n : Nat) : Nat :=
  match v with
  | .reference _ => n
  | _ => min n 1500

def indexedValueSize (v : Value) : Size := (fieldValueSize v).map (indexedCharge v)

inductive Scope
  | singleCollection
  | singleGroup
  | compositeCollection
  | compositeGroup
  deriving Inhabited

def parentNameSize : Option Path → Size
  | none => some 0
  | some path => documentNameSize path

def indexedFieldsSize : Fields → Size
  | [] => some 0
  | (_, v) :: fs => addSizes (indexedValueSize v) (indexedFieldsSize fs)

def indexEntrySize (scope : Scope) (path : Path) (parent : Option Path) (fields : Fields) : Size := do
  let name ← documentNameSize path
  let parentBytes ← parentNameSize parent
  match scope with
  | .singleCollection =>
    let (k, v) ← fields.head?
    addSizes (addSizes (addSizes (add name parentBytes) (stringSize k)) (indexedValueSize v)) (some 32)
  | .singleGroup =>
    let (k, v) ← fields.head?
    addSizes (addSizes (addSizes (some name) (stringSize k)) (indexedValueSize v)) (some 48)
  | .compositeCollection => addSizes (addSizes (add name parentBytes) (indexedFieldsSize fields)) (some 32)
  | .compositeGroup => addSizes (addSizes (some name) (indexedFieldsSize fields)) (some 32)

/-- Unbounded index charges after the raw values have been checked. -/
def indexedFieldsBytes (fields : Fields) : Nat :=
  (fields.map fun (_, v) => indexedCharge v (valueBytes v)).sum

def parentBytes (parent : Option Path) : Nat :=
  (parent.map fun p => 16 + segmentBytes p).getD 0

def indexFields : Scope → Fields → Fields
  | .singleCollection, fs | .singleGroup, fs => fs.take 1
  | .compositeCollection, fs | .compositeGroup, fs => fs

def indexEntryBytes (scope : Scope) (path : Path) (parent : Option Path) (fields : Fields) : Option Nat :=
  let name := 16 + segmentBytes path
  match scope with
  | .singleCollection => fields.head?.map fun (k, v) =>
    name + parentBytes parent + stringBytes k + indexedCharge v (valueBytes v) + 32
  | .singleGroup => fields.head?.map fun (k, v) =>
    name + stringBytes k + indexedCharge v (valueBytes v) + 48
  | .compositeCollection => some (name + parentBytes parent + indexedFieldsBytes fields + 32)
  | .compositeGroup => some (name + indexedFieldsBytes fields + 32)

end DS
