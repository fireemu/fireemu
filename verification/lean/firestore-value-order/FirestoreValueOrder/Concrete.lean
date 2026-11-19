import FirestoreValueOrder.Spec

/-!
# Concrete values and their abstraction

`RValue` mirrors the Rust `Value` enum: integers are `i64` values, doubles are `f64` bit
patterns, strings and references are Lean strings, map entries are in key order. `toVal`
maps a concrete value onto the abstract `Val` of `Spec.lean`; the specified order of two
concrete values is `cmp a.toVal b.toVal`.
-/

namespace FVO

inductive RValue
  | null
  | boolean (b : Bool)
  /-- An `i64`. -/
  | integer (i : Int)
  /-- An `f64`, by its IEEE 754 bit pattern. -/
  | double (bits : UInt64)
  | timestamp (seconds : Int) (nanos : Nat)
  | string (s : String)
  | bytes (b : List UInt8)
  | reference (s : String)
  | geoPoint (latitude longitude : UInt64)
  | array (xs : List RValue)
  | vector (xs : List UInt64)
  /-- Entries in strictly increasing key byte order, as a Rust `BTreeMap` iterates. -/
  | map (entries : List (String × RValue))
  deriving Repr, Inhabited

/-- Exact value of an `f64` bit pattern. A finite double is `z * 2^-1074` for the `Int`
`z` returned in `fin z`: a subnormal with fraction `m` is `m * 2^-1074`, a normal number
with biased exponent `e` and fraction `m` is `(2^52 + m) * 2^(e - 1075)`, that is
`(2^52 + m) * 2^(e - 1)` units of `2^-1074`. -/
def dblOfBits (bits : UInt64) : Dbl :=
  let n : Nat := bits.toNat
  let negative := n / 2 ^ 63 % 2 = 1
  let e : Nat := n / 2 ^ 52 % 2 ^ 11
  let m : Nat := n % 2 ^ 52
  if e = 2047 then
    if m = 0 then (if negative then .negInf else .posInf) else .nan
  else
    let mag : Int := if e = 0 then (m : Int) else (((2 ^ 52 + m) * 2 ^ (e - 1) : Nat) : Int)
    .fin (if negative then -mag else mag)

/-- An `i64` in units of `2^-1074`. -/
def intUnits (i : Int) : Int := i * 2 ^ 1074

def utf8 (s : String) : List Nat := s.toUTF8.toList.map (·.toNat)

/-- Path segments of a reference, split at every `/` as Rust `str::split('/')` does. -/
def segments (s : String) : List (List Nat) := (s.splitOn "/").map utf8

def numOfDbl : Dbl → Val
  | .nan => .nan
  | .negInf => .num .negInf
  | .fin z => .num (.fin z)
  | .posInf => .num .posInf

mutual
def RValue.toVal : RValue → Val
  | .null => .null
  | .boolean b => .bool b
  | .integer i => .num (.fin (intUnits i))
  | .double bits => numOfDbl (dblOfBits bits)
  | .timestamp s n => .timestamp s n
  | .string s => .string (utf8 s)
  | .bytes b => .bytes (b.map (·.toNat))
  | .reference s => .reference (segments s)
  | .geoPoint la lo => .geoPoint (dblOfBits la) (dblOfBits lo)
  | .array xs => .array (RValue.toVals xs)
  | .vector xs => .vector (xs.map dblOfBits)
  | .map es => .map (RValue.toEntries es)

def RValue.toVals : List RValue → List Val
  | [] => []
  | x :: xs => x.toVal :: RValue.toVals xs

def RValue.toEntries : List (String × RValue) → List (List Nat × Val)
  | [] => []
  | (k, v) :: es => (utf8 k, v.toVal) :: RValue.toEntries es
end

/-- The specified order on concrete values. -/
def rcmp (a b : RValue) : Ordering := cmp a.toVal b.toVal

/-! ## Documented equalities -/

def isNaNBits (bits : UInt64) : Prop := dblOfBits bits = .nan

/-- Every NaN equals every other NaN, whatever the payload and sign. -/
theorem nan_eq_nan {b₁ b₂ : UInt64} (h₁ : isNaNBits b₁) (h₂ : isNaNBits b₂) :
    rcmp (.double b₁) (.double b₂) = .eq := by
  simp only [isNaNBits] at h₁ h₂
  simp [rcmp, RValue.toVal, h₁, h₂, numOfDbl, cmp, Val.rank, cmpNat, cmpInt]

/-- The canonical quiet NaN is a NaN. -/
theorem quiet_nan_is_nan : isNaNBits 0x7ff8000000000000 := by
  unfold isNaNBits dblOfBits; decide

/-- `-0.0` equals `0.0`. -/
theorem neg_zero_eq_zero : rcmp (.double 0x8000000000000000) (.double 0) = .eq := by
  simp [rcmp, RValue.toVal, dblOfBits, numOfDbl, cmp, cmpNum, comap, pairCmp, Num.key,
    cmpNat, cmpInt]

set_option exponentiation.threshold 2048 in
/-- The integer `1` equals the double `1.0`. -/
theorem one_eq_one_point_zero : rcmp (.integer 1) (.double 0x3ff0000000000000) = .eq := by
  simp [rcmp, RValue.toVal, dblOfBits, numOfDbl, intUnits, cmp, cmpNum, comap, pairCmp,
    Num.key, cmpNat, cmpInt]

/-- NaN sorts below every number, including negative infinity. -/
theorem nan_lt_neg_inf : rcmp (.double 0x7ff8000000000000) (.double 0xfff0000000000000) = .lt := by
  simp only [rcmp, RValue.toVal]
  exact cmp_of_rank_lt (by decide)

end FVO
