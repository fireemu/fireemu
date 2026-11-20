import Std

namespace RtdbKeyOrder

def legalUnit (c : Char) : Bool :=
  32 ≤ c.toNat && c.toNat != 127 && !(".$#[]/".contains c)

def valid (key : String) : Bool := !key.isEmpty && key.toList.all legalUnit

def decimal (c : Char) : Bool := '0' ≤ c && c ≤ '9'

def valueOfDigits (cs : List Char) : Nat :=
  cs.foldl (fun n c => 10 * n + (c.toNat - '0'.toNat)) 0

def integer (key : String) : Option Int :=
  let signed := key.toList.head? == some '-'
  let cs := if signed then key.toList.drop 1 else key.toList
  if cs.isEmpty || !cs.all decimal then none
  else
    let n : Int := valueOfDigits cs
    let n := if signed then -n else n
    if -2147483648 ≤ n && n ≤ 2147483647 then some n else none

def utf16Point (n : Nat) : List Nat :=
  if n < 65536 then [n]
  else
    let offset := n - 65536
    [55296 + offset / 1024, 56320 + offset % 1024]

def utf16 (key : String) : List Nat :=
  key.toList.flatMap (utf16Point ∘ Char.toNat)

def keyCompare (a b : String) : Ordering :=
  match integer a, integer b with
  | some x, some y => (compare x y).then ((compare a.utf8ByteSize b.utf8ByteSize).then (List.compareLex compare (utf16 a) (utf16 b)))
  | some _, none => .lt
  | none, some _ => .gt
  | none, none => List.compareLex compare (utf16 a) (utf16 b)

theorem negativeOrPositiveBoundary (key : String) (n : Int)
    (h : integer key = some n) : -2147483648 ≤ n ∧ n ≤ 2147483647 := by
  dsimp only [integer] at h
  split at h <;> split at h <;> try contradiction
  all_goals split at h <;> simp_all <;> omega

theorem integerBeforeText {a b : String} {x : Int}
    (ha : integer a = some x) (hb : integer b = none) : keyCompare a b = .lt := by
  simp [keyCompare, ha, hb]

theorem textUsesUtf16 {a b : String}
    (ha : integer a = none) (hb : integer b = none) :
    keyCompare a b = List.compareLex compare (utf16 a) (utf16 b) := by
  simp [keyCompare, ha, hb]

theorem singleUnit (n : Nat) (h : n < 65536) : utf16Point n = [n] := by
  simp [utf16Point, h]

theorem supplementaryUnits (n : Nat) (lo : 65536 ≤ n) (hi : n ≤ 1114111) :
    ∃ a b, utf16Point n = [a, b] ∧
      55296 ≤ a ∧ a < 56320 ∧ 56320 ≤ b ∧ b < 57344 := by
  refine ⟨55296 + (n - 65536) / 1024, 56320 + (n - 65536) % 1024, ?_, ?_⟩
  · simp [utf16Point, Nat.not_lt.mpr lo]
  · omega

theorem astralBeforePrivateUse : keyCompare "𐀀" "" = .lt := by decide

/-- info: 'RtdbKeyOrder.negativeOrPositiveBoundary' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms negativeOrPositiveBoundary
/-- info: 'RtdbKeyOrder.integerBeforeText' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms integerBeforeText
/-- info: 'RtdbKeyOrder.textUsesUtf16' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms textUsesUtf16
/-- info: 'RtdbKeyOrder.singleUnit' depends on axioms: [propext] -/
#guard_msgs in #print axioms singleUnit
/-- info: 'RtdbKeyOrder.supplementaryUnits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms supplementaryUnits
/-- info: 'RtdbKeyOrder.astralBeforePrivateUse' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms astralBeforePrivateUse

end RtdbKeyOrder
