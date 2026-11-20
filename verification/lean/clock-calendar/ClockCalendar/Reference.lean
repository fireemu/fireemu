import ClockCalendar.Model

namespace CC

namespace Reference

def localAt (instant offset : Int) : Except Error Civil := do
  let seconds ← require .yearOutOfRange (checked minI64 maxI64 (instant / nsSecond))
  let _ ← require .overflow (checked minI64 maxI64 (seconds + offset))
  let wall := instant + offset * nsSecond
  let (y, m, d) := civilFromDays (wall / nsDay)
  checkYear y
  return ⟨y, m, d, wall % nsDay⟩

def month (c : Civil) (delta : Int) : Except Error Civil := do
  let index := c.monthIndex + delta
  let year := index / 12
  let month := index % 12 + 1
  checkYear year
  return ⟨year, month, min c.day (monthLength year month), c.nanos⟩

def resolve (c : Civil) (offset : Int) : Except Error Int := do
  let instant := c.instant offset
  let _ ← require .overflow (checked minI64 maxI64 (instant / nsSecond))
  return instant

def anchorAt (c : Civil) (a : Anchor) : Except Error Civil :=
  match a with
  | .startOfDay => .ok { c with nanos := 0 }
  | .endOfDay => .ok { c with nanos := lastMicrosecond }
  | .startOfMonth => .ok { c with day := 1, nanos := 0 }
  | .endOfMonth => .ok { c with day := monthLength c.year c.month, nanos := lastMicrosecond }
  | .startOfNextMonth => month { c with day := 1, nanos := 0 } 1
  | .startOfYear => .ok { c with month := 1, day := 1, nanos := 0 }
  | .endOfYear => .ok { c with month := 12, day := 31, nanos := lastMicrosecond }

def calendar (start offset : Int) (d : Duration) : Except Error Int :=
  if d.monthDelta = 0 ∧ d.dayDelta = 0 then .ok start else do
    let m ← month (← localAt start offset) d.monthDelta
    let days := m.dayIndex + d.dayDelta
    if days < dayCount 1 1 1 ∨ dayCount 10000 1 1 ≤ days then .error .yearOutOfRange else
      let (y, mo, day) := civilFromDays days
      resolve ⟨y, mo, day, m.nanos⟩ offset

def snap (instant offset : Int) (anchor : Option Anchor) : Except Error Int :=
  match anchor with
  | none => .ok instant
  | some a => do
    let c ← localAt instant offset
    resolve (← anchorAt c a) offset

end Reference

open Reference in
/-- Evaluate the civil stages and check that the result lies in the UTC year range. -/
def referenceMove (start offset : Int) (duration : Option Duration) (anchor : Option Anchor) :
    Except Error Int := do
  let d := duration.getD {}
  let beforeClock ← Reference.calendar start offset d
  let clock ← require .overflow (checked minI128 maxI128 (beforeClock + d.clockDelta))
  let result ← snap clock offset anchor
  if instantInRange 0 result then
    return result
  else
    throw .yearOutOfRange

end CC
