import Std

namespace CTTime

def scale : Int := 1000000000
def maxDuration : Nat := 315576000000

def decimal (digits : List Char) : Option Nat :=
  if digits.isEmpty || !digits.all Char.isDigit then none else
    some (digits.foldl (fun total digit => total * 10 + (digit.toNat - '0'.toNat)) 0)

def fraction (digits : List Char) : Option Int := do
  if digits.length > 9 then none else
    let value ← decimal digits
    some (value * 10 ^ (9 - digits.length) : Nat)

def parseDuration (text : String) : Option Int := do
  let 's' :: revBody := text.toList.reverse | none
  let raw := revBody.reverse
  let (negative, body) := match raw with
    | '-' :: tail => (true, tail)
    | raw => (false, raw)
  let digits := body.takeWhile (· != '.')
  let seconds ← decimal digits
  if seconds > maxDuration then none else
    let nanos ← match body.drop digits.length with
      | [] => some 0
      | '.' :: frac => fraction frac
      | _ => none
    let magnitude := (seconds : Int) * scale + nanos
    some (if negative then -magnitude else magnitude)

def leap (y : Nat) : Bool := y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)

def daysInMonth (y month : Nat) : Nat :=
  if month == 2 then (if leap y then 29 else 28)
  else if [4, 6, 9, 11].contains month then 30 else 31

def daysBeforeYear (y : Nat) : Nat :=
  let complete := y - 1
  complete * 365 + complete / 4 + complete / 400 - complete / 100

def serialDay (y m d : Nat) : Int :=
  let priorMonths := ((List.range (m - 1)).map (fun i => daysInMonth y (i + 1))).sum
  (daysBeforeYear y + priorMonths + d - 1 : Nat) - (daysBeforeYear 1970 : Int)

def offset (zone : List Char) : Option Int := do
  match zone with
  | ['Z'] => some 0
  | [sign, h1, h2, ':', m1, m2] =>
    if sign != '+' && sign != '-' then none else
      let h ← decimal [h1, h2]
      let m ← decimal [m1, m2]
      if h > 23 || m > 59 then none else
        let magnitude := (h * 3600 + m * 60 : Nat)
        some (if sign == '-' then -(magnitude : Int) else magnitude)
  | _ => none

def parseTimestamp (text : String) : Option Int := do
  let y1 :: y2 :: y3 :: y4 :: '-' :: m1 :: m2 :: '-' :: d1 :: d2 :: 'T' ::
      h1 :: h2 :: ':' :: n1 :: n2 :: ':' :: s1 :: s2 :: tail := text.toList | none
  let y ← decimal [y1, y2, y3, y4]
  let m ← decimal [m1, m2]
  let d ← decimal [d1, d2]
  let h ← decimal [h1, h2]
  let n ← decimal [n1, n2]
  let s ← decimal [s1, s2]
  if y == 0 || m == 0 || m > 12 || d == 0 || d > daysInMonth y m ||
      h > 23 || n > 59 || s > 60 then none else
    let (fractional, zone) := match tail with
      | '.' :: rest =>
        let digits := rest.takeWhile Char.isDigit
        (fraction digits, rest.drop digits.length)
      | rest => (some 0, rest)
    let nanos ← fractional
    let zoneOffset ← offset zone
    some ((serialDay y m d * 86400 + (h * 3600 + n * 60 + s : Nat) - zoneOffset) * scale + nanos)

def pad (width value : Nat) : String :=
  let rendered := toString value
  String.ofList (List.replicate (width - rendered.length) '0') ++ rendered

def fractionText (remainder : Int) : String :=
  if remainder == 0 then ""
  else if remainder % 1000000 == 0 then "." ++ pad 3 (remainder / 1000000).toNat
  else if remainder % 1000 == 0 then "." ++ pad 6 (remainder / 1000).toNat
  else "." ++ pad 9 remainder.toNat

def formatDuration (nanos : Int) : String :=
  toString (nanos / scale) ++ fractionText (nanos % scale) ++ "s"

/-- A formatting oracle for days near the epoch and the service's out-of-i64-seconds fallback. -/
def formatEpochTimestamp (nanos : Int) : Option String := do
  let whole := nanos / scale
  let seconds := if whole < -(2 ^ 63) || whole ≥ 2 ^ 63 then 0 else whole
  let civil ← match seconds / 86400 with
    | -1 => some "1969-12-31"
    | 0 => some "1970-01-01"
    | 1 => some "1970-01-02"
    | _ => none
  let localSecond := (seconds % 86400).toNat
  let hours := pad 2 (localSecond / 3600)
  let minutes := pad 2 (localSecond / 60 % 60)
  let secs := pad 2 (localSecond % 60)
  some (civil ++ "T" ++ hours ++ ":" ++ minutes ++ ":" ++ secs ++ fractionText (nanos % scale) ++ "Z")

def secondsCases : List String := ["00", "59", "60", "61"]
def fractionalCases : List (String × String) :=
  [("absent", ""), ("millis", ".123"), ("micros", ".123456"), ("nanos", ".123456789"),
   ("empty", "."), ("tooLong", ".1234567890")]
def zoneCases : List (String × String) :=
  [("utc", "Z"), ("east", "+01:30"), ("west", "-23:59"), ("badHour", "+24:00"),
   ("badMinute", "-00:60"), ("lowercase", "z"), ("missing", "")]

end CTTime
