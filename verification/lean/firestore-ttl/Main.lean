import FirestoreTtl

open FirestoreTtl

private def faultCode : OffsetFault → String
  | .syntax => "syntax"
  | .precision => "precision"
  | .range => "range"

private def offsetRow (labels : List String) (input : String) : String :=
  let result := match parseOffset input with
    | .ok n => [s!"ok:{n}", formatOffset n]
    | .error fault => [faultCode fault, "-"]
  String.intercalate "\t" (["offset"] ++ labels ++ [input] ++ result)

private def offsetMatrix : List String := Id.run do
  let mut rows := #[]
  for (sign, leading) in [("unsigned", ""), ("minus", "-"), ("plus", "+")] do
    for (whole, integer) in [
        ("zero", "0"), ("small", "42"), ("leading-zero", "000042"),
        ("boundary", toString secondsLimit), ("over", toString (secondsLimit + 1)),
        ("overflow", "9223372036854775808"), ("empty", ""), ("unicode", "１２")] do
      for (fraction, fractionText) in [
          ("none", ""), ("zero", ".0"), ("zero-nine", ".000000000"),
          ("nonzero", ".1"), ("nonzero-nine", ".000000001"),
          ("too-long", ".0000000000"), ("empty", "."), ("junk", ".0q")] do
        rows := rows.push (offsetRow [sign, whole, fraction] (leading ++ integer ++ fractionText ++ "s"))
  return rows.toList

private def additionalOffsets : List String :=
  [("empty", ""), ("missing-suffix", "42"), ("upper-suffix", "42S"),
   ("trailing-space", "42s "), ("leading-space", " 42s"), ("multiple-dots", "42.0.0s"),
   ("negative-zero-padded", "-000s"), ("negative-fraction", "-0.000000001s"),
   ("nanoseconds-before-overflow", "9223372036854775808.001s"),
   ("overflow-before-zero-fraction", "9223372036854775808.000s")]
  |>.map (fun (label, input) => offsetRow ["extra", label, "syntax"] input)

private def expiryMatrix : List String := Id.run do
  let mut rows := #[]
  for (field, hasTimestamp) in [
      ("direct", true), ("nested", true), ("missing", false), ("wrong-type", false), ("blocked", false)] do
    for (timestamp, storedAt) in [("epoch", 0), ("second-boundary", 999999999),
        ("minimum", minTimestamp), ("maximum", maxTimestamp)] do
      for (offset, delay) in [
          ("unset", none), ("zero", some 0), ("one-second", some nanosPerSecond),
          ("max-seconds", some (Int.ofNat secondsLimit * nanosPerSecond)),
          ("negative", some (-1)), ("max-nanos", some maxI128), ("min-nanos", some minI128)] do
        for (probe, adjustment) in [("before", -1), ("equal", 0), ("after", 1)] do
          let effective := timestampAt (storedAt + delay.getD 0)
          let current := timestampAt (effective + adjustment)
          let stored := if hasTimestamp then some storedAt else none
          let exactOffset := delay.elim "-" toString
          rows := rows.push (String.intercalate "\t" [
            "expiry", field, timestamp, offset, probe, toString storedAt,
            toString current, exactOffset, toString (expired stored delay current)])
  return rows.toList

private def clocks : List String :=
  [minI128, minTimestamp - 1, minTimestamp, minTimestamp + 1, -1, 0, 1,
   maxTimestamp - 1, maxTimestamp, maxTimestamp + 1, maxI128]
  |>.map (fun instant =>
    String.intercalate "\t" ["clock", toString instant, toString (timestampAt instant)])

def main : IO Unit := do
  let rows := offsetMatrix ++ additionalOffsets ++ expiryMatrix ++ clocks
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
