import Std

namespace FunctionsCron

def nanosPerSecond : Int := 1_000_000_000

def admitsDay (dom dow : Option Int) (day weekday : Int) : Bool :=
  match dom, dow with
  | none, none => true
  | some d, none => day == d
  | none, some w => weekday == w
  | some d, some w => (day == d) || (weekday == w)

structure Fields where
  minutes : List Nat
  hours : List Nat
  dom : Option Int := none
  month : Option Int := none
  dow : Option Int := none

inductive Rule where
  | cron (fields : Fields)
  | interval (seconds : Int)

def withinWindow (start stop : Int) (runs : List Int) : List Int :=
  runs.filter (fun sec => start < sec * nanosPerSecond && sec * nanosPerSecond ≤ stop)

def countRuns (interval : Bool) (cap count : Nat) : Bool × Nat :=
  if interval || count ≤ max 1 cap then (true, count) else (false, max 1 cap)

/-- Euclidean Gregorian civil month and day, indexed by days since 1970-01-01. -/
def monthDay (days : Int) : Int × Int :=
  let shifted := days + 719468
  let dayOfEra := shifted % 146097
  let yearOfEra := (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365
  let dayOfYear := dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
  let monthPrime := (5 * dayOfYear + 2) / 153
  let day := dayOfYear - (153 * monthPrime + 2) / 5 + 1
  (if monthPrime < 10 then monthPrime + 3 else monthPrime - 9, day)

def admitted (rule : Fields) (civilDay : Int) : Bool :=
  let (month, day) := monthDay civilDay
  rule.month.all (· == month) && admitsDay rule.dom rule.dow day ((civilDay + 4) % 7)

/-- Enumerate the selected civil minutes in a finite day range. This reference has no
forward or reverse field jumps. The corpus gives every rule a range containing its next run. -/
def candidates (rule : Rule) (start offset : Int) (days : Nat) : List Int :=
  match rule with
  | .interval seconds =>
      let first := (start / nanosPerSecond) / seconds
      (List.range ((Int.ofNat days * 86_400 / seconds).toNat + 1)).map
        (fun i => (first + Int.ofNat i + 1) * seconds)
  | .cron fields =>
      let first := ((start / nanosPerSecond) + offset) / 86_400
      (List.range days).flatMap fun i =>
        let day := first + Int.ofNat i
        if admitted fields day then
          fields.hours.flatMap fun hour =>
            fields.minutes.map fun minute =>
              day * 86_400 + Int.ofNat hour * 3_600 + Int.ofNat minute * 60 - offset
        else []

end FunctionsCron
