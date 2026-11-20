import Std

namespace CTRetry

def exhausted (limit attempt : Nat) (budget : Option Nat) (elapsed : Nat) : Bool :=
  decide (limit < attempt) &&
    match budget with
    | none | some 0 => true
    | some positive => decide (positive < elapsed)

/-- Exact arithmetic on the subset where the Rust floating-point calculation represents integers. -/
def declaredGap (minMillis maxMillis doublings attempt : Nat) : Nat :=
  min maxMillis ((2 ^ min (attempt - 1) doublings +
    (attempt - (doublings + 1)) * 2 ^ doublings) * minMillis)

def productionFloor (gap : Nat) : Nat :=
  if gap < 12 then 0 else if gap < 15 then 4000 else if gap < 17 then 8000 else 10000

def gapMillis (production : Bool) (gap declared : Nat) : Nat :=
  if production then max declared (productionFloor gap) else declared

def limits : List Nat := [0, 1, 3, 4294967295]
def budgets : List (String × Option Nat) := [("none", none), ("zero", some 0), ("positive", some 10)]
def elapsed : List Nat := [0, 1, 9, 10, 11, 18446744073709551615]
def attempts : List Nat := [0, 1, 2, 3, 4, 11, 12, 14, 15, 16, 17, 4294967295]

-- The small multipliers and units keep raw values below 2^53, including a u32::MAX attempt.
def backoffs : List (String × Nat × Nat × Nat) :=
  [("immediate", 0, 10000, 1), ("noDoubling", 200, 10000, 0),
   ("earlyCap", 1000, 2000, 1), ("linearTail", 100, 10000, 2),
   ("severalDoublings", 250, 3600000, 8)]

end CTRetry
