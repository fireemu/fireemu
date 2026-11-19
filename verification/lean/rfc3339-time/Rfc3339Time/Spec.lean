import Std

namespace RfcTime

abbrev Civil := Int × Int × Int

def leap (y : Int) : Prop := (y % 4 = 0 ∧ y % 100 ≠ 0) ∨ y % 400 = 0

instance (y : Int) : Decidable (leap y) := by
  unfold leap
  infer_instance

def daysInMonth (y m : Int) : Int :=
  if m = 2 then (if leap y then 29 else 28)
  else if m = 4 ∨ m = 6 ∨ m = 9 ∨ m = 11 then 30
  else if 1 ≤ m ∧ m ≤ 12 then 31 else 0

def ValidDate (y m d : Int) : Prop := 1 ≤ m ∧ m ≤ 12 ∧ 1 ≤ d ∧ d ≤ daysInMonth y m

instance (y m d : Int) : Decidable (ValidDate y m d) := by
  unfold ValidDate
  infer_instance

def yearStart (y : Int) : Int := y * 365 + y / 4 - y / 100

def monthStart (m : Int) : Int := (153 * m + 2) / 5

def marchYear (y m : Int) : Int := if m ≤ 2 then y - 1 else y

def marchMonth (m : Int) : Int := (m + 9) % 12

def daysFromCivil (y m d : Int) : Int :=
  let y := marchYear y m
  let era := y / 400
  let yoe := y % 400
  let doy := monthStart (marchMonth m) + d - 1
  era * 146097 + (yearStart yoe + doy) - 719468

def eraYear (doe : Int) : Int :=
  (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365

def civilFromDays (n : Int) : Civil :=
  let days := n + 719468
  let era := days / 146097
  let doe := days % 146097
  let yoe := eraYear doe
  let y := yoe + era * 400
  let doy := doe - yearStart yoe
  let mp := (5 * doy + 2) / 153
  let d := doy - monthStart mp + 1
  let m := if mp < 10 then mp + 3 else mp - 9
  (if m ≤ 2 then y + 1 else y, m, d)

def i64Min : Int := -9223372036854775808
def i64Max : Int := 9223372036854775807
def i128Min : Int := -170141183460469231731687303715884105728
def i128Max : Int := 170141183460469231731687303715884105727

def fitsI64 (x : Int) : Prop := i64Min ≤ x ∧ x ≤ i64Max

instance (x : Int) : Decidable (fitsI64 x) := by
  unfold fitsI64
  infer_instance

/-- Rust uses truncating remainder and division for the shifted month. -/
def truncMonthStart (shiftedMonth : Int) : Int :=
  (153 * shiftedMonth.tmod 12 + 2).tdiv 5

def daysFromCivilRaw (y m d : Int) : Int :=
  let k := marchYear y m
  let doy := truncMonthStart (m + 9) + d - 1
  k / 400 * 146097 + (yearStart (k % 400) + doy) - 719468

/-- A Rust input triple and every potentially overflowing intermediate in source order. -/
def CivilFits (y m d : Int) : Prop :=
  let k := marchYear y m
  let eraDays := k / 400 * 146097
  let daySum := truncMonthStart (m + 9) + d
  let doy := daySum - 1
  let doe := yearStart (k % 400) + doy
  let fromMarch := eraDays + doe
  fitsI64 y ∧ fitsI64 m ∧ fitsI64 d ∧ fitsI64 k ∧ fitsI64 (m + 9) ∧
    fitsI64 daySum ∧ fitsI64 doy ∧ fitsI64 doe ∧ fitsI64 eraDays ∧
    fitsI64 fromMarch ∧ fitsI64 (fromMarch - 719468)

instance (y m d : Int) : Decidable (CivilFits y m d) := by
  unfold CivilFits
  infer_instance

def daysFromCivilChecked (y m d : Int) : Option Int :=
  if CivilFits y m d then some (daysFromCivilRaw y m d) else none

/-- Wrapping applies before division for the year subtraction and month addition.
The remaining additions, subtractions and multiplications compose modulo 2^64. -/
def daysFromCivilWrapping (y m d : Int) : Int :=
  let wrap := fun x : Int => (x - i64Min) % (2 ^ 64) + i64Min
  let k := wrap (marchYear y m)
  let doy := truncMonthStart (wrap (m + 9)) + d - 1
  wrap (k / 400 * 146097 + (yearStart (k % 400) + doy) - 719468)

def civilFromDaysI64 (n : Int) : Civil :=
  let (y, m, d) := civilFromDays n
  (if fitsI64 y then y else if y < 0 then i64Min else i64Max,
    if fitsI64 m then m else 1, if fitsI64 d then d else 1)

def nanosPerSecond : Int := 1000000000
def secondsPerDay : Int := 86400

structure ParseError where
  offset : Nat
  expected : String
  deriving DecidableEq, Repr

structure Cursor where
  input : List Char
  pos : Nat := 0
  deriving DecidableEq

def Cursor.err (c : Cursor) (expected : String) : ParseError := ⟨c.pos, expected⟩

def digitValue (ch : Char) : Option Nat :=
  if 48 ≤ ch.toNat ∧ ch.toNat < 58 then some (ch.toNat - 48) else none

def decimal : Nat → Nat → List Char
  | 0, _ => []
  | w + 1, n =>
    Char.ofNat (48 + n / 10 ^ w) :: decimal w (n % 10 ^ w)

def readDigits (expected : String) : Nat → Cursor → Except ParseError (Nat × Cursor)
  | 0, c => .ok (0, c)
  | w + 1, c => do
    let ch :: tail := c.input | throw (c.err expected)
    let some n := digitValue ch | throw (c.err expected)
    let (low, rest) ← readDigits expected w ⟨tail, c.pos + 1⟩
    pure (n * 10 ^ w + low, rest)

def expect (allowed : List Char) (expected : String) (c : Cursor) : Except ParseError Cursor :=
  match c.input with
  | ch :: tail => if ch ∈ allowed then .ok ⟨tail, c.pos + 1⟩ else .error (c.err expected)
  | [] => .error (c.err expected)

/-- Scan up to the remaining precision; a further ASCII digit is an error at its position. -/
def fractionDigits : Nat → Cursor → Except ParseError (Nat × Nat × Cursor)
  | w, c =>
    match c.input with
    | [] => .ok (0, 0, c)
    | ch :: tail =>
      match digitValue ch with
      | none => .ok (0, 0, c)
      | some n =>
        match w with
        | 0 => .error (c.err "at most nine fractional digits")
        | w + 1 => do
          let (low, count, rest) ← fractionDigits w ⟨tail, c.pos + 1⟩
          pure (n * 10 ^ w + low, count + 1, rest)
  termination_by w => w

def readFraction (c : Cursor) : Except ParseError (Nat × Cursor) := do
  match c.input with
  | ch :: tail =>
    if ch = '.' then
      let start : Cursor := ⟨tail, c.pos + 1⟩
      let (n, count, rest) ← fractionDigits 9 start
      if count = 0 then throw (start.err "fractional digits after '.'") else pure (n, rest)
    else pure (0, c)
  | [] => pure (0, c)

def readZone (c : Cursor) : Except ParseError (Int × Cursor) := do
  let ch :: tail := c.input | throw (c.err "'Z' or numeric offset")
  let start : Cursor := ⟨tail, c.pos + 1⟩
  if ch = 'Z' ∨ ch = 'z' then pure (0, start)
  else if ch = '+' ∨ ch = '-' then
    let (h, c) ← readDigits "two-digit offset hour" 2 start
    let c ← expect [':'] "':' in offset" c
    let (m, c) ← readDigits "two-digit offset minute" 2 c
    if h > 23 ∨ m > 59 then throw (c.err "offset within +-23:59")
    let seconds : Int := Int.ofNat h * 3600 + Int.ofNat m * 60
    pure ((if ch = '+' then seconds else -seconds), c)
  else throw (c.err "'Z' or numeric offset")

structure DateTime where
  year : Nat
  month : Nat
  day : Nat
  hour : Nat
  minute : Nat
  second : Nat
  deriving DecidableEq

def DateTime.Valid (t : DateTime) : Prop :=
  t.year < 10000 ∧ ValidDate t.year t.month t.day ∧ t.hour < 24 ∧ t.minute < 60 ∧ t.second < 60

def dateTimeText (t : DateTime) (sep : Char) : List Char :=
  decimal 4 t.year ++ ['-'] ++ decimal 2 t.month ++ ['-'] ++ decimal 2 t.day ++ [sep] ++
    decimal 2 t.hour ++ [':'] ++ decimal 2 t.minute ++ [':'] ++ decimal 2 t.second

def readDateTime (c : Cursor) : Except ParseError (DateTime × Cursor) := do
  let (y, c) ← readDigits "four-digit year" 4 c
  let c ← expect ['-'] "'-' after year" c
  let (m, c) ← readDigits "two-digit month" 2 c
  let c ← expect ['-'] "'-' after month" c
  let (d, c) ← readDigits "two-digit day" 2 c
  let c ← expect ['T', 't'] "'T' date-time separator" c
  let (h, c) ← readDigits "two-digit hour" 2 c
  let c ← expect [':'] "':' after hour" c
  let (min, c) ← readDigits "two-digit minute" 2 c
  let c ← expect [':'] "':' after minute" c
  let (s, c) ← readDigits "two-digit second" 2 c
  pure (⟨y, m, d, h, min, s⟩, c)

def validate (t : DateTime) : Except ParseError Unit := do
  if ¬ (1 ≤ t.month ∧ t.month ≤ 12) then throw ⟨5, "month 01-12"⟩
  if t.day = 0 ∨ Int.ofNat t.day > daysInMonth t.year t.month then
    throw ⟨8, "valid day of month"⟩
  if t.hour > 23 then throw ⟨11, "hour 00-23"⟩
  if t.minute > 59 then throw ⟨14, "minute 00-59"⟩
  if t.second > 59 then throw ⟨17, "second 00-59"⟩

def denote (t : DateTime) (fraction : Nat) (offset : Int) : Int :=
  let days := daysFromCivil t.year t.month t.day
  let seconds := days * secondsPerDay + Int.ofNat t.hour * 3600 + Int.ofNat t.minute * 60 + t.second
  (seconds - offset) * nanosPerSecond + fraction

def parse (text : List Char) : Except ParseError Int := do
  let (t, c) ← readDateTime ⟨text, 0⟩
  let (fraction, c) ← readFraction c
  let (offset, c) ← readZone c
  if !c.input.isEmpty then throw (c.err "end of input")
  validate t
  pure (denote t fraction offset)

def parseRfc3339 (text : String) : Except ParseError Int := parse text.toList

def format (instant : Int) : Except Int (List Char) :=
  let secs := instant / nanosPerSecond
  let fraction := (instant % nanosPerSecond).toNat
  let (y, m, d) := civilFromDays (secs / secondsPerDay)
  if 0 ≤ y ∧ y ≤ 9999 then
    let sod := secs % secondsPerDay
    let t : DateTime := ⟨y.toNat, m.toNat, d.toNat, (sod / 3600).toNat,
      (sod % 3600 / 60).toNat, (sod % 60).toNat⟩
    let subsec := if fraction = 0 then [] else '.' :: decimal 9 fraction
    .ok (dateTimeText t 'T' ++ subsec ++ ['Z'])
  else .error y

def formatRfc3339 (instant : Int) : Except Int String := (format instant).map String.ofList

end RfcTime
