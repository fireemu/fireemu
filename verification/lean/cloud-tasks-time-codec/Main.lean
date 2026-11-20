import CloudTasksTimeCodec

open CTTime

def output (x : Option Int) : String := match x with | some n => toString n | none => "reject"

def durationInputs : List String :=
  ["0s", "00s", "000001s", "15s", "30s", "-0s", "-0.5s", "-1.499999999s", "-1.500s",
   "1.1s", "1.123456s", "1.123456789s", "315576000000s", "-315576000000.999999999s",
   "315576000000.999999999s", "315576000001s", "170141183460469231731687303715884105728s",
   "", ".", "1", "1S", "+1s", "1.s", ".1s", "1.1234567890s", "1.0.0s", "--1s", "１２s"]

def timestampInputs : List String :=
  ["0000-12-31T23:59:59Z", "0001-01-01T00:00:00+00:01", "9999-12-31T23:59:59-00:01",
   "10000-01-01T00:00:00Z", "1900-02-29T00:00:00Z", "2000-02-29T00:00:00Z",
   "2024-12-31T23:59:60Z", "2025-01-01T00:00:00Z", "2024-04-31T00:00:00Z",
   "2024-01-00T00:00:00Z", "2024-00-01T00:00:00Z", "2024-01-01T24:00:00Z",
   "2024-01-01T00:60:00Z", "2024-01-01t00:00:00Z", "2024-01-01T00:00:00+0000",
   "2024-01-01T00:00:00+00:00"]

def formatInputs : List Int :=
  [-86400000000000, -999999999, -500000000, -1000000, -1000, -1, 0, 1, 1000, 1000000,
   999999999, 1000000000, 1500000000, 86399999999999, 86400000000000,
   -(2 ^ 127), 2 ^ 127 - 1]

def main : IO Unit := do
  IO.println "# duration/timestamp parser and formatter rows, pipe-delimited"
  for second in secondsCases do
    for (fractionLabel, fractional) in fractionalCases do
      for (zoneLabel, zone) in zoneCases do
        let input := "1970-01-01T00:00:" ++ second ++ fractional ++ zone
        IO.println s!"timestamp|{second}|{fractionLabel}|{zoneLabel}|{input}|{output (parseTimestamp input)}"
  for input in timestampInputs do
    IO.println s!"timestamp|extra|extra|extra|{input}|{output (parseTimestamp input)}"
  for input in durationInputs do
    IO.println s!"duration|{input}|{output (parseDuration input)}"
  for nanos in formatInputs do
    IO.println s!"formatDuration|{nanos}|{formatDuration nanos}"
    match formatEpochTimestamp nanos with
    | some ts => IO.println s!"formatTimestamp|{nanos}|{ts}"
    | none => throw (IO.userError "format input outside epoch oracle")
