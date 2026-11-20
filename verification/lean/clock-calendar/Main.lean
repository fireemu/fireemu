import ClockCalendar

/-!
The first line is `# N cases.`. Each following line has five space-separated fields:
`start-nanos offset-seconds duration anchor result`. A missing duration or anchor is `-`.
Durations use the canonical ISO spelling. The result is a signed decimal nanosecond count,
`Overflow` or `YearOutOfRange`.
-/

open CC

def Anchor.name : CC.Anchor → String
  | .startOfDay => "startOfDay"
  | .endOfDay => "endOfDay"
  | .startOfMonth => "startOfMonth"
  | .endOfMonth => "endOfMonth"
  | .startOfNextMonth => "startOfNextMonth"
  | .startOfYear => "startOfYear"
  | .endOfYear => "endOfYear"

def durationText (d : Duration) : String :=
  let part := fun (n, unit) => if n = (0 : Nat) then "" else s!"{n}{unit}"
  let calendar := String.join ([(d.years, "Y"), (d.months, "M"), (d.weeks, "W"), (d.days, "D")].map part)
  let clock := String.join ([(d.hours, "H"), (d.minutes, "M"), (d.seconds, "S")].map part)
  if calendar.isEmpty && clock.isEmpty then "PT0S"
  else (if d.negative then "-P" else "P") ++ calendar ++ (if clock.isEmpty then "" else "T" ++ clock)

structure Case where
  start : Int
  offset : Int := 0
  duration : Option Duration := none
  anchor : Option CC.Anchor := none

def atWall (year month day offset : Int) (nanos : Int := 0) : Int :=
  (⟨year, month, day, nanos⟩ : Civil).instant offset

def offsets : List Int := [0, 3600, -18000, 20700, -50400, 50400]

def anchors : List CC.Anchor :=
  [.startOfDay, .endOfDay, .startOfMonth, .endOfMonth, .startOfNextMonth, .startOfYear, .endOfYear]

def cases : List Case := Id.run do
  let mut out := #[]
  for offset in offsets do
    for month in (List.range 12).map (fun m => Int.ofNat m + 1) do
      for day in [28, 29, 30, 31] do
        if day ≤ monthLength 2024 month then
          for negative in [false, true] do
            out := out.push ⟨atWall 2024 month day offset 123456789, offset, some { negative, months := 1 }, none⟩
    for a in anchors do
      out := out.push ⟨atWall 2024 2 29 offset (nsDay - 1), offset, none, some a⟩
      out := out.push ⟨atWall 1969 12 31 offset (nsDay - 1), offset, some { seconds := 1 }, some a⟩
    for negative in [false, true] do
      for d in ([{ years := 1 }, { years := 4 }, { years := 76 }, { years := 1, months := 1 },
          { weeks := 2, days := 3 }, { days := 1 }, { hours := 36, minutes := 17, seconds := 3 },
          { seconds := 1 }, { months := 1, days := 1, hours := 2 }] : List Duration) do
        out := out.push ⟨atWall 2024 2 29 offset (nsDay - 7), offset, some { d with negative }, none⟩
  let low := atWall 1 1 1 0
  let high := atWall 10000 1 1 0
  for start in [low - 1, low, low + 1, high - 1, high, high + 1] do
    for anchor in none :: anchors.map some do
      out := out.push { start := start, anchor := anchor }
  let u64Max := 18446744073709551615
  return out.toList ++ [
    ⟨low, 0, some {}, none⟩,
    ⟨low, 0, some { negative := true, months := 1 }, none⟩,
    ⟨low, 0, some { negative := true, days := 1 }, none⟩,
    ⟨high - 1, 0, some { months := 1 }, none⟩,
    ⟨high - 1, 0, some { days := 1 }, none⟩,
    ⟨high - 1, 0, some { seconds := 1 }, none⟩,
    ⟨high - nsSecond - 1, 0, some { seconds := 1 }, none⟩,
    ⟨high - nsSecond, 0, some { seconds := 1 }, none⟩,
    ⟨low + nsSecond - 1, 0, some { negative := true, seconds := 1 }, none⟩,
    ⟨low - 1, 0, some { seconds := 1 }, none⟩,
    ⟨high, 0, some { negative := true, seconds := 1 }, none⟩,
    ⟨low, -3600, none, none⟩,
    ⟨low, -3600, none, some .startOfDay⟩,
    ⟨low, -3600, some { hours := 1 }, none⟩,
    ⟨low + 3600 * nsSecond, -3600, some { negative := true, seconds := 1 }, none⟩,
    ⟨high - 1, 3600, none, some .startOfDay⟩,
    ⟨high - 3600 * nsSecond - 1, 3600, some { seconds := 1 }, none⟩,
    ⟨low - 1, 3600, some { seconds := 1 }, none⟩,
    ⟨low - 1, 3600, none, some .startOfDay⟩,
    ⟨high, -3600, some { negative := true, seconds := 1 }, none⟩,
    ⟨high, -3600, none, some .startOfDay⟩,
    ⟨atWall 2025 2 28 0, 0, some { months := 1 }, none⟩,
    ⟨atWall 2024 2 29 0, 0, some { years := 1 }, none⟩,
    ⟨atWall 2024 2 29 0, 0, some { years := 1, months := 1 }, none⟩,
    ⟨atWall 2024 1 31 0, 0, some { months := 1 }, none⟩,
    ⟨atWall 2024 2 29 0, 0, some { negative := true, months := 1 }, none⟩,
    ⟨0, 0, some { years := u64Max }, none⟩,
    ⟨0, 0, some { negative := true, months := u64Max }, none⟩,
    ⟨0, 0, some { weeks := u64Max }, none⟩,
    ⟨0, 0, some { days := u64Max }, none⟩,
    ⟨0, 0, some { hours := u64Max, minutes := u64Max }, none⟩,
    ⟨0, 0, some { negative := true, seconds := u64Max }, none⟩,
    ⟨maxI128, 0, some { seconds := u64Max }, none⟩,
    ⟨minI128, 0, some { negative := true, seconds := 1 }, none⟩,
    ⟨maxI64 * nsSecond, 1, none, some .startOfDay⟩,
    ⟨minI64 * nsSecond, -1, none, some .startOfDay⟩]

def runCase (c : Case) : String :=
  let d := c.duration.map durationText |>.getD "-"
  let a := c.anchor.map Anchor.name |>.getD "-"
  let result := match referenceMove c.start c.offset c.duration c.anchor with
    | .ok n => toString n
    | .error .overflow => "Overflow"
    | .error .yearOutOfRange => "YearOutOfRange"
  s!"{c.start} {c.offset} {d} {a} {result}"

def main : IO Unit := do
  IO.println s!"# {cases.length} cases."
  for c in cases do
    IO.println (runCase c)
