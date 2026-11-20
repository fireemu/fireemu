import Std

namespace EventRetry

def maxInt : Int := 2 ^ 127 - 1
def minInt : Int := -(2 ^ 127)

structure Policy where
  attempts : Nat
  base : Int
  cap : Int
  doublings : Option Nat := none
  window : Option Int := none

/-- Constructor errors in order, including the outer window validation. -/
def Policy.error (p : Policy) : Option String :=
  if p.window.any (· < 0) then some "negative"
  else if p.attempts = 0 then some "zero"
  else if p.base < 0 ∨ p.cap < 0 then some "negative"
  else if p.cap < p.base then some "inverted"
  else none

/-- Backoff indexed by the failed attempt, including the implementation's conservative
cutoff on the number of doublings. Since all terms are nonnegative in admitted policies,
mathematical addition followed by the cap agrees with checked arithmetic and cap fallback. -/
def Policy.backoff (p : Policy) (attempt : Nat) : Int :=
  let shift := attempt - 1
  let d := min shift (p.doublings.getD shift)
  if d ≥ 120 then p.cap
  else min p.cap (p.base * 2 ^ d + 2_000_000_000 * (shift - d : Nat))

def Policy.byAttempts (p : Policy) (attempt : Nat) : Bool := attempt < p.attempts

/-- An allowed next attempt may use either the attempt budget or the inclusive age budget. -/
def Policy.byAge (p : Policy) (attempt : Nat) (elapsed : Int) : Bool :=
  let next := elapsed + p.backoff attempt
  p.byAttempts attempt || p.window.any (fun maxAge =>
    decide (minInt ≤ next ∧ next ≤ maxInt ∧ next ≤ maxAge))

end EventRetry
