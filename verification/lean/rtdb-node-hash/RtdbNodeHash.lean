import Std

namespace RtdbNodeHash

inductive Number where
  | int (n : Int)
  | bits (word : UInt64)

def Number.binary64 : Number → UInt64
  | .int n => (Float.Model.ofInt n).toBits
  | .bits word => word

inductive Priority where
  | number (value : Number)
  | text (value : String)

inductive Leaf where
  | flag (value : Bool)
  | number (value : Number)
  | text (value : String)

structure ChildRef where
  key : String
  priorityRank : Nat
  keyRank : Nat
  digest : String

def hexDigits : Nat → Nat → List Char
  | 0, _ => []
  | width + 1, n => hexDigits width (n / 16) ++ ["0123456789abcdef".toList[n % 16]!]

def numberText (n : Number) : String :=
  "number:" ++ String.ofList (hexDigits 16 n.binary64.toNat)

def priorityText : Option Priority → String
  | none => ""
  | some (.number n) => "priority:" ++ numberText n ++ ":"
  | some (.text s) => "priority:string:" ++ s ++ ":"

def leafText (priority : Option Priority) (leaf : Leaf) : String :=
  priorityText priority ++
    match leaf with
    | .flag b => "boolean:" ++ toString b
    | .number n => numberText n
    | .text s => "string:" ++ s

def keyFragments : List ChildRef → String
  | [] => ""
  | child :: tail => ":" ++ child.key ++ ":" ++ child.digest ++ keyFragments tail

def byPriorityAndKey (a b : ChildRef) : Bool :=
  a.priorityRank < b.priorityRank ||
  (a.priorityRank == b.priorityRank && a.keyRank ≤ b.keyRank)

def parentText (priority : Option Priority) (children : List ChildRef) : String :=
  priorityText priority ++ keyFragments (children.mergeSort byPriorityAndKey)

theorem widthOfHex (width n : Nat) : (hexDigits width n).length = width := by
  induction width generalizing n with
  | zero => rfl
  | succ width ih => simp [hexDigits, ih]

theorem sameBitsHashText (n : Int) :
    numberText (.int n) = numberText (.bits (Float.Model.ofInt n).toBits) := by rfl

theorem keyFragmentsAppend (left right : List ChildRef) :
    keyFragments (left ++ right) = keyFragments left ++ keyFragments right := by
  induction left with
  | nil => simp [keyFragments]
  | cons head tail ih => simp [keyFragments, ih, String.append_assoc]

theorem equalPriorityUsesKey (a b : ChildRef) (same : a.priorityRank = b.priorityRank) :
    byPriorityAndKey a b = decide (a.keyRank ≤ b.keyRank) := by simp [byPriorityAndKey, same]

/-- info: 'RtdbNodeHash.widthOfHex' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms widthOfHex
/-- info: 'RtdbNodeHash.sameBitsHashText' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms sameBitsHashText
/-- info: 'RtdbNodeHash.keyFragmentsAppend' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms keyFragmentsAppend
/-- info: 'RtdbNodeHash.equalPriorityUsesKey' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms equalPriorityUsesKey

private def rotate (w : UInt32) (shift : UInt32) : UInt32 :=
  (w <<< shift) ||| (w >>> (32 - shift))

private def words (block : ByteArray) (start : Nat) : Array UInt32 := Id.run do
  let mut schedule := #[]
  for i in [0:16] do
    let offset := start + 4 * i
    let word := (block[offset]!.toUInt32 <<< 24) |||
      (block[offset + 1]!.toUInt32 <<< 16) ||| (block[offset + 2]!.toUInt32 <<< 8) |||
      block[offset + 3]!.toUInt32
    schedule := schedule.push word
  for i in [16:80] do
    let next := schedule[i - 3]! ^^^ schedule[i - 8]! ^^^ schedule[i - 14]! ^^^ schedule[i - 16]!
    schedule := schedule.push (rotate next 1)
  return schedule

private abbrev HashWords := UInt32 × UInt32 × UInt32 × UInt32 × UInt32

private def roundInputs (index : Nat) (b c d : UInt32) : UInt32 × UInt32 :=
  if index < 20 then ((b &&& c) ||| ((~~~b) &&& d), 0x5a827999)
  else if index < 40 then (b ^^^ c ^^^ d, 0x6ed9eba1)
  else if index < 60 then ((b &&& c) ||| (b &&& d) ||| (c &&& d), 0x8f1bbcdc)
  else (b ^^^ c ^^^ d, 0xca62c1d6)

private def compress (state : HashWords) (data : Array UInt32) : HashWords :=
  let next := (List.range 80).foldl (fun (a, b, c, d, e) i =>
    let (f, k) := roundInputs i b c d
    (rotate a 5 + f + e + k + data[i]!, a, rotate b 30, c, d)) state
  let (a, b, c, d, e) := state
  let (a', b', c', d', e') := next
  (a + a', b + b', c + c', d + d', e + e')

private def bigEndian (width n : Nat) : List UInt8 :=
  (List.range width).reverse.map (fun i => (n / 256 ^ i).toUInt8)

def sha1 (bytes : ByteArray) : List UInt8 :=
  let padding := (56 + 64 - (bytes.size + 1) % 64) % 64
  let padded := bytes ++ ByteArray.mk (([128] ++ List.replicate padding 0 ++ bigEndian 8 (bytes.size * 8)).toArray)
  let initial : HashWords := (0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0)
  let (a, b, c, d, e) :=
    (List.range (padded.size / 64)).foldl (fun state i => compress state (words padded (64 * i))) initial
  [a, b, c, d, e].flatMap (bigEndian 4 ∘ UInt32.toNat)

private def b64Digit (n : Nat) : Char :=
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toList[n % 64]!

private def base64 : List UInt8 → List Char
  | a :: b :: c :: tail =>
    [b64Digit (a.toNat / 4), b64Digit ((a.toNat % 4) * 16 + b.toNat / 16),
      b64Digit ((b.toNat % 16) * 4 + c.toNat / 64), b64Digit c.toNat] ++ base64 tail
  | [a, b] =>
    [b64Digit (a.toNat / 4), b64Digit ((a.toNat % 4) * 16 + b.toNat / 16),
      b64Digit ((b.toNat % 16) * 4), '=']
  | [a] => [b64Digit (a.toNat / 4), b64Digit ((a.toNat % 4) * 16), '=', '=']
  | [] => []

def hashText (text : String) : String :=
  String.ofList (base64 (sha1 text.toUTF8))

#guard hashText "abc" == "qZk+NkcGgWq6PiVxeFDCbJzQ2J0="
#guard hashText "" == "2jmj7l5rSw0yVb/vlWAYkK/YBwk="

def hashLeaf (priority : Option Priority) (leaf : Leaf) : String :=
  hashText (leafText priority leaf)

def hashParent (priority : Option Priority) (children : List ChildRef) : String :=
  hashText (parentText priority children)

end RtdbNodeHash
