import Std

namespace CC

def nsSecond : Int := 1_000_000_000
def nsDay : Int := 86_400_000_000_000
def lastMicrosecond : Int := nsDay - 1000

structure Civil where
  year : Int
  month : Int
  day : Int
  nanos : Int
  deriving DecidableEq, Repr

structure Duration where
  negative : Bool := false
  years : Nat := 0
  months : Nat := 0
  weeks : Nat := 0
  days : Nat := 0
  hours : Nat := 0
  minutes : Nat := 0
  seconds : Nat := 0
  deriving Repr

inductive Anchor where
  | startOfDay | endOfDay | startOfMonth | endOfMonth | startOfNextMonth | startOfYear | endOfYear
  deriving DecidableEq, Repr

inductive MoveKind where
  | advance | set | advanceTo
  deriving DecidableEq, Repr

inductive Decision where
  | forward | rewind | refuseBackwards
  deriving DecidableEq, Repr

inductive Error where
  | overflow | yearOutOfRange
  deriving DecidableEq, Repr

def inYearRange (year : Int) : Prop := 1 ≤ year ∧ year ≤ 9999
instance (year : Int) : Decidable (inYearRange year) := inferInstanceAs (Decidable (_ ∧ _))

def leap (year : Int) : Bool :=
  decide ((year % 4 = 0 ∧ year % 100 ≠ 0) ∨ year % 400 = 0)

def monthLength (year month : Int) : Int :=
  if month = 2 then (if leap year then 29 else 28)
  else if month = 4 ∨ month = 6 ∨ month = 9 ∨ month = 11 then 30 else 31

def validDate (year month day : Int) : Prop :=
  1 ≤ month ∧ month ≤ 12 ∧ 1 ≤ day ∧ day ≤ monthLength year month

def Civil.valid (c : Civil) : Prop := validDate c.year c.month c.day ∧ 0 ≤ c.nanos ∧ c.nanos < nsDay

def Civil.monthIndex (c : Civil) : Int := c.year * 12 + c.month - 1

/-- Month offsets from January 1 in a common year. -/
def monthPrefix (month : Int) : Int :=
  if month ≤ 1 then 0 else if month = 2 then 31 else if month = 3 then 59
  else if month = 4 then 90 else if month = 5 then 120 else if month = 6 then 151
  else if month = 7 then 181 else if month = 8 then 212 else if month = 9 then 243
  else if month = 10 then 273 else if month = 11 then 304 else 334

def dayCount (year month day : Int) : Int :=
  let prev := year - 1
  365 * prev + prev / 4 - prev / 100 + prev / 400 - 719162 +
    monthPrefix month + (if 2 < month ∧ leap year then 1 else 0) + day - 1

def Civil.dayIndex (c : Civil) : Int := dayCount c.year c.month c.day

def Civil.instant (c : Civil) (offset : Int) : Int :=
  c.dayIndex * nsDay + c.nanos - offset * nsSecond

def MonthStep (start : Civil) (months : Int) (result : Civil) : Prop :=
  result.monthIndex = start.monthIndex + months ∧
  result.day = min start.day (monthLength result.year result.month) ∧ result.nanos = start.nanos

def DayStep (start : Civil) (days : Int) (result : Civil) : Prop :=
  result.dayIndex = start.dayIndex + days ∧ result.nanos = start.nanos

def ClockStep (start nanos result : Int) : Prop := result = start + nanos

/-- Anchors are stated as local civil dates, with the next month specified by its ordinal. -/
def AnchorSpec (start : Civil) (anchor : Anchor) (result : Civil) : Prop :=
  match anchor with
  | .startOfDay => result = { start with nanos := 0 }
  | .endOfDay => result = { start with nanos := lastMicrosecond }
  | .startOfMonth => result = { start with day := 1, nanos := 0 }
  | .endOfMonth => result = { start with day := monthLength start.year start.month, nanos := lastMicrosecond }
  | .startOfNextMonth => result.monthIndex = start.monthIndex + 1 ∧ result.day = 1 ∧ result.nanos = 0
  | .startOfYear => result = { start with month := 1, day := 1, nanos := 0 }
  | .endOfYear => result = { start with month := 12, day := 31, nanos := lastMicrosecond }

def instantInRange (offset instant : Int) : Prop :=
  dayCount 1 1 1 * nsDay ≤ instant + offset * nsSecond ∧
  instant + offset * nsSecond < dayCount 10000 1 1 * nsDay
instance (offset instant : Int) : Decidable (instantInRange offset instant) :=
  inferInstanceAs (Decidable (_ ∧ _))

def Duration.signed (d : Duration) (n : Nat) : Int := if d.negative then -(n : Int) else n
def Duration.monthDelta (d : Duration) : Int := d.signed (12 * d.years + d.months)
def Duration.dayDelta (d : Duration) : Int := d.signed (7 * d.weeks + d.days)
def Duration.clockDelta (d : Duration) : Int := d.signed (3600 * d.hours + 60 * d.minutes + d.seconds) * nsSecond

/-- The result must lie in UTC years 0001 through 9999. A nonzero calendar part checks
the starting local date and the month and day results. An anchor checks the local date
it reads and the date it produces. Clock-only and empty moves without an anchor
compute no local date. -/
def MoveSpec (start offset : Int) (duration : Option Duration) (anchor : Option Anchor)
    (result : Int) : Prop :=
  let d := duration.getD {}
  ∃ calendar clock : Int,
    (if d.monthDelta = 0 ∧ d.dayDelta = 0 then calendar = start else
      ∃ initial afterMonths afterDays : Civil,
        initial.valid ∧ afterMonths.valid ∧ afterDays.valid ∧
        inYearRange initial.year ∧ inYearRange afterMonths.year ∧ inYearRange afterDays.year ∧
        initial.instant offset = start ∧ MonthStep initial d.monthDelta afterMonths ∧
        DayStep afterMonths d.dayDelta afterDays ∧ afterDays.instant offset = calendar) ∧
    ClockStep calendar d.clockDelta clock ∧
    (match anchor with
    | none => result = clock
    | some a => ∃ beforeAnchor afterAnchor : Civil,
        beforeAnchor.valid ∧ afterAnchor.valid ∧
        inYearRange beforeAnchor.year ∧ inYearRange afterAnchor.year ∧
        beforeAnchor.instant offset = clock ∧ AnchorSpec beforeAnchor a afterAnchor ∧
        afterAnchor.instant offset = result) ∧
    instantInRange 0 result

def DecisionSpec (kind : MoveKind) (allow : Bool) (current target : Int) (result : Decision) : Prop :=
  match result with
  | .forward => current ≤ target
  | .rewind => target < current ∧ allow = true ∧ (kind = .advance ∨ kind = .set)
  | .refuseBackwards => target < current ∧ (allow = false ∨ kind = .advanceTo)

end CC
