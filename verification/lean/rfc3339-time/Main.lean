import Rfc3339Time

/-!
# Golden corpus generator

The first line is `# <count> cases`. Each remaining line is one tab-separated case:

* `parse<TAB><hex UTF-8><TAB>ok<TAB><nanoseconds>`
* `parse<TAB><hex UTF-8><TAB>error<TAB><byte offset><TAB><expected>`
* `format<TAB><nanoseconds><TAB>ok<TAB><UTC text>`
* `format<TAB><nanoseconds><TAB>error<TAB><year>`
* `days<TAB><year><TAB><month><TAB><day><TAB>ok<TAB><days>`
* `days<TAB><year><TAB><month><TAB><day><TAB>overflow<TAB><wrapping days>`
* `civil<TAB><days><TAB><year><TAB><month><TAB><day>`

Hex preserves empty strings, non-ASCII characters and whitespace in parse inputs.
Numbers are signed decimal, except byte offsets and the count.
-/

open RfcTime

def hex (s : String) : String :=
  String.ofList (s.toUTF8.data.toList.flatMap fun b =>
    let digits := "0123456789abcdef".toList
    [digits[b.toNat / 16]!, digits[b.toNat % 16]!])

def parseCase (text : String) : String :=
  let input := hex text
  match parseRfc3339 text with
  | .ok n => s!"parse\t{input}\tok\t{n}"
  | .error e => s!"parse\t{input}\terror\t{e.offset}\t{e.expected}"

def formatCase (n : Int) : String :=
  match formatRfc3339 n with
  | .ok text => s!"format\t{n}\tok\t{text}"
  | .error y => s!"format\t{n}\terror\t{y}"

def daysCase (date : Civil) : String :=
  let (y, m, d) := date
  match daysFromCivilChecked y m d with
  | some n => s!"days\t{y}\t{m}\t{d}\tok\t{n}"
  | none => s!"days\t{y}\t{m}\t{d}\toverflow\t{daysFromCivilWrapping y m d}"

def civilCase (n : Int) : String :=
  let (y, m, d) := civilFromDaysI64 n
  s!"civil\t{n}\t{y}\t{m}\t{d}"

def monthEdges (years : List Int) : List Civil :=
  years.flatMap fun y => (List.range 12).flatMap fun i =>
    let m := Int.ofNat (i + 1)
    [(y, m, 1), (y, m, daysInMonth y m)]

def parseTexts : List String :=
  let fractions := "" :: (List.range 9).map (fun i => "." ++ String.ofList ("012345678".toList.take (i + 1)))
  let offsets := ["Z", "z", "+00:00", "-00:00", "+00:01", "-00:01", "+23:59", "-23:59"]
  let prefixes := ["0000-01-01T00:00:00", "1969-12-31T23:59:59", "1970-01-01T00:00:00",
    "2000-02-29t12:34:56", "2024-02-29T23:59:59", "9999-12-31T23:59:59"]
  let valid := prefixes.flatMap fun p => fractions.flatMap fun f => offsets.map fun o => p ++ f ++ o
  let ends := (monthEdges [1900, 2000, 2024, 2100]).map fun (y, m, d) =>
    String.ofList (dateTimeText ⟨y.toNat, m.toNat, d.toNat, 0, 0, 0⟩ 'T' ++ ['Z'])
  let malformed := [
    "", " ", "000-01-01T00:00:00Z", "-001-01-01T00:00:00Z", "10000-01-01T00:00:00Z",
    "1970/01-01T00:00:00Z", "1970-01/01T00:00:00Z", "1970-1-01T00:00:00Z",
    "1970-01-1T00:00:00Z", "1970-01-01 00:00:00Z", "1970-01-01T0:00:00Z",
    "1970-01-01T00-00:00Z", "1970-01-01T00:00-00Z", "1970-01-01T00:0:00Z",
    "1970-01-01T00:00:0Z", "1970-01-01T00:00:00", "1970-01-01T00:00:00.Z",
    "1970-01-01T00:00:00.0000000000Z", "1970-01-01T00:00:00.1234567890+00:00",
    "1970-01-01T00:00:00.1.2Z", "1970-01-01T00:00:00,1Z", "1970-01-01T00:00:00+",
    "1970-01-01T00:00:00+0:00", "1970-01-01T00:00:00+00", "1970-01-01T00:00:00+0000",
    "1970-01-01T00:00:00+00:0", "1970-01-01T00:00:00+24:00", "1970-01-01T00:00:00-23:60",
    "1970-01-01T00:00:00ZZ", "1970-01-01T00:00:00+00:00Z", "1970-01-01T00:00:00Z\n",
    "1970-01-01T00:00:00Z\x00", "1970-01-01T00:00:00Z ", " 1970-01-01T00:00:00Z",
    "１９７０-01-01T00:00:00Z", "1970-01-01T00:00:00.éZ", "1970-01-01T00:00:00.Zé",
    "1970-01-01T00:00:00Zé", "1970-00-01T00:00:00Z", "1970-13-01T00:00:00Z",
    "1970-01-00T00:00:00Z", "1900-02-29T00:00:00Z", "2100-02-29T00:00:00Z",
    "2000-02-30T00:00:00Z", "2024-04-31T00:00:00Z", "1970-01-01T24:00:00Z",
    "1970-01-01T00:60:00Z", "2016-12-31T23:59:60Z", "2016-12-31T23:59:60.5-23:59",
    "1970-01-01T00:00:61Z", "1970-00-00T24:60:60Z", "1970-00-00T24:60:60+24:00",
    "1970-00-00T24:60:60Z!"]
  valid ++ ends ++ malformed

def main : IO Unit := do
  let dates := monthEdges [-400, -1, 0, 1, 1582, 1900, 1969, 1970, 2000, 2024, 2100, 9999]
  let uncheckedDates := [(i64Min, 1, 1), (i64Max, 12, 31), civilFromDays i64Max,
    (25252734927768524, 7, 28), (1970, 0, 1), (1970, -10, 1), (1970, 2, 30), (1970, 13, 0),
    (1970, i64Max, 1), (1970, i64Min, 1), (1970, 3, i64Min), (1970, 4, i64Max)]
  let edgeDays := [i64Min, i64Min + 1, -146097, -719469, -719468, -719467, -1, 0, 1, 60, 146097,
    i64Max - 719469, i64Max - 719468, i64Max - 719467, i64Max - 1, i64Max]
  let days := dates.map (fun (y, m, d) => daysFromCivil y m d)
  let dayNanos := secondsPerDay * nanosPerSecond
  let low := daysFromCivil 0 1 1 * dayNanos
  let high := daysFromCivil 10000 1 1 * dayNanos
  let instants := [i128Min, i128Min + 1, low - dayNanos, low - 60 * nanosPerSecond, low - 1, low, low + 1, -dayNanos - 1,
    -dayNanos, -nanosPerSecond - 1, -nanosPerSecond, -1, 0, 1, nanosPerSecond - 1, nanosPerSecond,
    high - 2, high - 1, high, high + 1, high + 59 * nanosPerSecond, high + dayNanos, i128Max - 1, i128Max]
  let cases := parseTexts.map parseCase ++
    (instants ++ days.filterMap (fun n => if low ≤ n * dayNanos then
      some (n * dayNanos + 45296123456789) else none)).map formatCase ++
    (dates ++ uncheckedDates ++ [civilFromDays i64Min]).map daysCase ++
    (edgeDays ++ days).map civilCase
  IO.println s!"# {cases.length} cases"
  for c in cases do IO.println c
