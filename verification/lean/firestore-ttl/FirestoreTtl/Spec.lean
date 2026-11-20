import Std

namespace FirestoreTtl

def secondsLimit : Nat := 2147483647
def nanosPerSecond : Int := 1000000000

inductive OffsetFault
  | syntax
  | precision
  | range
  deriving DecidableEq, Repr

def decimal (c : Char) : Bool := '0' ≤ c && c ≤ '9'

def readWhole (text : String) : Except OffsetFault (Bool × Nat) :=
  let (negative, chars) := match text.toList with
    | '-' :: digits => (true, digits)
    | digits => (false, digits)
  if !chars.isEmpty && chars.all decimal then
    let value := chars.foldl (fun acc c => acc * 10 + (c.toNat - '0'.toNat)) 0
    .ok (negative, value)
  else .error .syntax

def checkFraction (text : String) : Except OffsetFault Unit :=
  if text.isEmpty || text.length > 9 || !text.toList.all decimal then .error .syntax
  else if text.toList.all (· == '0') then .ok ()
  else .error .precision

def readParts (text : String) : Except OffsetFault (Bool × Nat) := do
  let 's' :: body := text.toList.reverse | throw .syntax
  match (String.ofList body.reverse).splitOn "." with
  | [whole] => readWhole whole
  | [whole, fraction] =>
    let seconds ← readWhole whole
    checkFraction fraction
    pure seconds
  | _ => throw .syntax

def admitSeconds (negative : Bool) (seconds : Nat) : Except OffsetFault Nat :=
  if seconds ≤ secondsLimit ∧ (negative = true → seconds = 0) then .ok seconds
  else .error .range

def parseOffset (text : String) : Except OffsetFault Nat :=
  (readParts text).bind (fun (negative, seconds) => admitSeconds negative seconds)

def formatOffset (seconds : Nat) : String := toString seconds ++ "s"

def minI128 : Int := -170141183460469231731687303715884105728
def maxI128 : Int := 170141183460469231731687303715884105727
def minTimestamp : Int := -62135596800 * nanosPerSecond
def maxTimestamp : Int := 253402300799 * nanosPerSecond + 999999999

def saturate (value : Int) : Int := min maxI128 (max minI128 value)

def timestampAt (now : Int) : Int := min maxTimestamp (max minTimestamp now)

/-- Missing or non-timestamp values have no expiry candidate. Offsets are nanoseconds. -/
def expired (stored offset : Option Int) (now : Int) : Bool :=
  stored.any (fun storedAt => saturate (storedAt + offset.getD 0) < now)

end FirestoreTtl
