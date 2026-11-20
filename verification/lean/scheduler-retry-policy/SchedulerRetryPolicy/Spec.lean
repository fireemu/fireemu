import Std

namespace SRP

inductive Generation where
  | first | second
  deriving DecidableEq

structure Config where
  count : Nat
  window : Nat
  minBackoff : Nat
  maxBackoff : Nat
  maxDoublings : Nat

structure Policy where
  attempts : Nat
  minimum : Nat
  maximum : Nat
  doublings : Nat
  windowSeconds : Option Nat

def u32Max : Nat := 4294967295

def i64Max : Nat := 9223372036854775807

def i128Max : Nat := 170141183460469231731687303715884105727

def nanosPerSecond : Nat := 1000000000

def clampSeconds (seconds : Nat) : Nat := min seconds i64Max

def backoffPair (c : Config) : Nat × Nat :=
  if c.minBackoff = 0 ∧ c.maxBackoff = 0 then (5, 3600)
  else (clampSeconds c.minBackoff, clampSeconds (max c.minBackoff c.maxBackoff))

def project (generation : Generation) (c : Config) : Policy :=
  let pair := backoffPair c
  let (attempts, window) := match generation with
    | .first => (1, none)
    | .second => (min (c.count + 1) u32Max,
        if c.window = 0 then none else some (clampSeconds c.window))
  ⟨attempts, pair.1, pair.2, if c.maxDoublings = 0 then 5 else c.maxDoublings, window⟩

def refusesJob (c : Config) : Bool := decide (c.count ≥ 6)

/-- Elapsed delay after the given attempt, in nanoseconds. Values outside signed 128-bit
arithmetic select the maximum, including the early cap at shifts of 120 or more. -/
def delay (policy : Policy) (attempt : Nat) : Nat :=
  let shift := attempt - 1
  let exponential := min shift policy.doublings
  let maximum := policy.maximum * nanosPerSecond
  if exponential ≥ 120 then maximum
  else min maximum
    (policy.minimum * nanosPerSecond * 2 ^ exponential + 2 * nanosPerSecond * (shift - exponential))

def fitsWindow (policy : Policy) (next : Int) : Bool :=
  policy.windowSeconds.any fun limit =>
    decide (next ≤ Int.ofNat i128Max ∧ next ≤ Int.ofNat (limit * nanosPerSecond))

/-- Elapsed is signed 128-bit; delays are nonnegative. Only upper overflow is possible. -/
def allows (policy : Policy) (attempt : Nat) (elapsed : Int) : Bool :=
  decide (attempt < policy.attempts) || fitsWindow policy (elapsed + Int.ofNat (delay policy attempt))

end SRP
