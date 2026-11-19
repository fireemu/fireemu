import Std

namespace TW

def nanosPerSecond : Int := 1000000000

def maxStep : Nat := 18446744073709551615

def floorStep (period : Nat) (nanos : Int) : Int :=
  nanos / (nanosPerSecond * (period : Int))

/-- An instant is signed nanoseconds since the Unix epoch; a Rust period is a u32. -/
def timeStep (period : Nat) (nanos : Int) : Nat :=
  let seconds := nanos / nanosPerSecond
  if seconds ≤ 0 ∨ period = 0 then 0
  else min maxStep (seconds / (period : Int)).toNat

abbrev Digest := Vector UInt8 20

/-- The key is fixed by the caller. The abstract HMAC takes the counter's eight bytes. -/
abbrev Hmac := List UInt8 → Digest

def counterBytes (counter : Nat) : List UInt8 :=
  (List.range 8).map fun i => UInt8.ofNat (counter / 256 ^ (7 - i) % 256)

def offset (digest : Digest) : Nat := digest[19].toNat % 16

theorem offset_lt (digest : Digest) : offset digest < 16 := Nat.mod_lt _ (by decide)

def truncate (digest : Digest) : Nat :=
  have bounds := offset_lt digest
  let i := offset digest
  16777216 * ((digest[i]'(by dsimp [i]; omega)).toNat % 128) +
    65536 * (digest[i + 1]'(by dsimp [i]; omega)).toNat +
    256 * (digest[i + 2]'(by dsimp [i]; omega)).toNat +
    (digest[i + 3]'(by dsimp [i]; omega)).toNat

def hotp (hmac : Hmac) (step digits : Nat) : Nat :=
  truncate (hmac (counterBytes step)) % 10 ^ min digits 9

def displayWidth (digits : Nat) : Nat := max 1 (min digits 9)

def showCode (hmac : Hmac) (step digits : Nat) : String :=
  let raw := (hotp hmac step digits).repr.toList
  String.ofList (List.replicate (displayWidth digits - raw.length) '0' ++ raw)

inductive CodeMatch where
  | accepted (step : Nat)
  | replayed
  | noMatch
  deriving DecidableEq

def windowLow (current window : Nat) : Nat := current - window

def windowHigh (current window : Nat) : Nat := min maxStep (current + window)

def windowSteps (current window : Nat) : List Nat :=
  let low := windowLow current window
  let high := windowHigh current window
  List.range' low (high - low + 1)

def fresh (last : Option Nat) (step : Nat) : Bool :=
  match last with
  | none => true
  | some old => decide (old < step)

/-- For a pure matcher, a fresh match takes priority over all stale testStep. -/
def matchStepWindow (current window : Nat) (last : Option Nat) (testStep : Nat → Bool) :
    CodeMatch :=
  let steps := windowSteps current window
  match steps.find? (fun step => testStep step && fresh last step) with
  | some step => .accepted step
  | none => if steps.any testStep then .replayed else .noMatch

def matchCode (hmac : Hmac) (detached : Bool) (period digits window : Nat)
    (last : Option Nat) (code : Nat) (nanos : Int) : CodeMatch :=
  if detached then .noMatch
  else matchStepWindow (timeStep period nanos) window last (fun step => hotp hmac step digits == code)

end TW
