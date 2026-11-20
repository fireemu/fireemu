import Std

namespace RunnerLogBounds

def high (unit : Nat) : Bool := 0xd800 ≤ unit && unit ≤ 0xdbff
def low (unit : Nat) : Bool := 0xdc00 ≤ unit && unit ≤ 0xdfff
def replacement : Char := Char.ofNat 0xfffd

/-- Input units are from a JavaScript UTF-16 string. Pair valid surrogates and replace lone units. -/
def normalize : List Nat → List Char
  | [] => []
  | [unit] =>
    [if high unit || low unit then replacement else Char.ofNat unit]
  | unit :: next :: tail =>
    if high unit && low next then
      Char.ofNat (0x10000 + (unit - 0xd800) * 1024 + next - 0xdc00) :: normalize tail
    else
      (if high unit || low unit then replacement else Char.ofNat unit) :: normalize (next :: tail)

def bytes (text : List Char) : Nat := (text.map Char.utf8Size).sum

/-- A prefix whose next scalar, if any, would not fit in the remaining budget. -/
def clip (budget : Nat) : List Char → List Char
  | [] => []
  | scalar :: rest =>
    if scalar.utf8Size ≤ budget then scalar :: clip (budget - scalar.utf8Size) rest
    else []

def marker : List Char := "... [truncated]".toList

def bound (budget : Nat) (normalized : List Char) : List Char :=
  if bytes normalized ≤ budget then normalized
  else if budget ≤ bytes marker then clip budget marker
  else clip (budget - bytes marker) normalized ++ marker

end RunnerLogBounds
