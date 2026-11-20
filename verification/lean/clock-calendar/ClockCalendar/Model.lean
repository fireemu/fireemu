import ClockCalendar.Spec

namespace CC

def daysFromCivil (y m d : Int) : Int :=
  let y := if m ≤ 2 then y - 1 else y
  let era := y / 400
  let yoe := y % 400
  let mp := (m + 9) % 12
  let doy := (153 * mp + 2) / 5 + d - 1
  let doe := yoe * 365 + yoe / 4 - yoe / 100 + doy
  era * 146097 + doe - 719468

def civilFromDaysWide (days : Int) : Int × Int × Int :=
  let z := days + 719468
  let era := z / 146097
  let doe := z % 146097
  let yoe := (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  let y := yoe + era * 400
  let doy := doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp := (5 * doy + 2) / 153
  let d := doy - (153 * mp + 2) / 5 + 1
  let m := if mp < 10 then mp + 3 else mp - 9
  (if m ≤ 2 then y + 1 else y, m, d)

def minI64 : Int := -9223372036854775808
def maxI64 : Int := 9223372036854775807
def minI128 : Int := -170141183460469231731687303715884105728
def maxI128 : Int := 170141183460469231731687303715884105727

def checked (lo hi n : Int) : Option Int := if lo ≤ n ∧ n ≤ hi then some n else none

def civilFromDays (days : Int) : Int × Int × Int :=
  let (y, m, d) := civilFromDaysWide days
  ((checked minI64 maxI64 y).getD (if y < 0 then minI64 else maxI64),
    (checked minI64 maxI64 m).getD 1, (checked minI64 maxI64 d).getD 1)

def require (err : Error) : Option α → Except Error α
  | none => .error err
  | some x => .ok x

def checkYear (year : Int) : Except Error Unit :=
  if inYearRange year then .ok () else .error .yearOutOfRange

def Local.of (instant offset : Int) : Except Error Civil := do
  let utc ← require .yearOutOfRange (checked minI64 maxI64 (instant / nsSecond))
  let wall ← require .overflow (checked minI64 maxI64 (utc + offset))
  let (y, m, d) := civilFromDays (wall / 86400)
  checkYear y
  return ⟨y, m, d, wall % 86400 * nsSecond + instant % nsSecond⟩

def Local.date (y m d nanos : Int) : Except Error Civil := do
  checkYear y
  return ⟨y, m, d, nanos⟩

def Local.plusMonths (c : Civil) (months : Int) : Except Error Civil := do
  if months = 0 then return c
  let total := c.year * 12 + (c.month - 1) + months
  let y ← require .yearOutOfRange (checked minI64 maxI64 (total / 12))
  checkYear y
  let m := (checked minI64 maxI64 (total % 12)).getD 0 + 1
  Local.date y m (min c.day (monthLength y m)) c.nanos

def Local.plusDays (c : Civil) (days : Int) : Except Error Civil := do
  if days = 0 then return c
  let count ← require .yearOutOfRange
    ((checked minI64 maxI64 days).filter fun d => d.natAbs ≤ 4_000_000)
  let (y, m, d) := civilFromDays (daysFromCivil c.year c.month c.day + count)
  Local.date y m d c.nanos

def Local.anchored (c : Civil) (anchor : Anchor) : Except Error Civil :=
  match anchor with
  | .startOfDay => Local.date c.year c.month c.day 0
  | .endOfDay => Local.date c.year c.month c.day lastMicrosecond
  | .startOfMonth => Local.date c.year c.month 1 0
  | .endOfMonth => Local.date c.year c.month (monthLength c.year c.month) lastMicrosecond
  | .startOfNextMonth => do Local.plusMonths (← Local.date c.year c.month 1 0) 1
  | .startOfYear => Local.date c.year 1 1 0
  | .endOfYear => Local.date c.year 12 31 lastMicrosecond

def Local.resolve (c : Civil) (offset : Int) : Except Error Int := do
  let whole ← require .overflow (checked minI64 maxI64 (c.nanos / nsSecond))
  let wall ← require .overflow (do
    let midnight ← checked minI64 maxI64 (daysFromCivil c.year c.month c.day * 86400)
    checked minI64 maxI64 (midnight + whole))
  let utc ← require .overflow (checked minI64 maxI64 (wall - offset))
  require .overflow (do
    let nanos ← checked minI128 maxI128 (utc * nsSecond)
    checked minI128 maxI128 (nanos + c.nanos % nsSecond))

def calendarPart (start offset : Int) (d : Duration) : Except Error Int := do
  if d.years = 0 ∧ d.months = 0 ∧ d.weeks = 0 ∧ d.days = 0 then return start
  let months ← require .overflow (do
    let years ← checked minI128 maxI128 ((d.years : Int) * 12)
    checked minI128 maxI128 (years + d.months))
  let days ← require .overflow (do
    let weeks ← checked minI128 maxI128 ((d.weeks : Int) * 7)
    checked minI128 maxI128 (weeks + d.days))
  let c ← Local.of start offset
  let c ← Local.plusMonths c (if d.negative then -months else months)
  let c ← Local.plusDays c (if d.negative then -days else days)
  Local.resolve c offset

def clockPart (start : Int) (d : Duration) : Except Error Int := do
  let nanos ← require .overflow (do
    let hours ← checked minI128 maxI128 ((d.hours : Int) * 3600)
    let minutes ← checked minI128 maxI128 ((d.minutes : Int) * 60)
    let hm ← checked minI128 maxI128 (hours + minutes)
    let hms ← checked minI128 maxI128 (hm + d.seconds)
    checked minI128 maxI128 (hms * nsSecond))
  require .overflow (checked minI128 maxI128 (start + if d.negative then -nanos else nanos))

def afterDuration (start offset : Int) (duration : Option Duration) : Except Error Int :=
  match duration with
  | none => .ok start
  | some d => do clockPart (← calendarPart start offset d) d

def anchorPart (instant offset : Int) (anchor : Option Anchor) : Except Error Int :=
  match anchor with
  | none => .ok instant
  | some a => do Local.resolve (← Local.anchored (← Local.of instant offset) a) offset

def moveInstant (start offset : Int) (duration : Option Duration) (anchor : Option Anchor) :
    Except Error Int := do
  let instant ← afterDuration start offset duration
  let result ← anchorPart instant offset anchor
  let seconds ← require .yearOutOfRange (checked minI64 maxI64 (result / nsSecond))
  checkYear (civilFromDays (seconds / 86400)).1
  return result

def decideMove (kind : MoveKind) (allow : Bool) (current target : Int) : Decision :=
  if current ≤ target then .forward
  else if allow && (kind != .advanceTo) then .rewind else .refuseBackwards

end CC
