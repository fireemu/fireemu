import FirestoreProtoValues

open FirestoreProtoValues

def verdict : Verdict → String
  | .same => "same"
  | .null => "null"
  | .missing => "missing"
  | .unsupported => "unsupported"
  | .map => "map"
  | .vector => "vector"
  | .badVector => "bad_vector"
  | .reservedName => "reserved_name"
  | .integerType => "integer_type"
  | .reservedType => "reserved_type"
  | .negativeNanos => "negative_nanos"
  | .rangeNanos => "range_nanos"
  | .rangeSeconds => "range_seconds"
  | .badGeo => "bad_geo"
  | .depth => "depth"

def scalars : List (String × Verdict) :=
  [("missing", .missing), ("reference_expression", .unsupported), ("null", .null),
    ("unknown_null", .null), ("boolean", .same), ("integer", .same), ("minus_zero", .same),
    ("nan_payload", .same), ("string", .same), ("bytes", .same), ("reference", .same)]

def markers : List (String × Marker) :=
  [("absent", .absent), ("exact", .exact), ("other", .other), ("integer", .integer)]

def payloads : List (String × Payload) :=
  [("empty", .empty), ("doubles", .doubles), ("mixed", .mixed), ("bad", .bad), ("scalar", .scalar)]

def extras : List (String × Extra) :=
  [("absent", .absent), ("ordinary", .ordinary), ("name", .name)]

/-- Expected IEEE payloads for the selected vector members. In the mixed case, Int64
    2^53 + 1 lies between the doubles 2^53 and 2^53 + 2 and widens to the even one. -/
def vectorBits : Payload → List Nat
  | .doubles => [9223372036854775808, 4602678819172646912]
  | .mixed => [4845873199050653696, 9223372036854775808]
  | _ => []

def coordinates : List (String × Option Int) :=
  [("-181", some (-181)), ("-90", some (-90)), ("0", some 0),
    ("90", some 90), ("180", some 180), ("NaN", none)]

def main : IO Unit := do
  IO.println "# KIND INPUTS EXPECTED, tab separated"
  for (name, result) in scalars do
    IO.println ("\t".intercalate ["scalar", name, verdict result])
  for (markerName, marker) in markers do
    for (payloadName, payload) in payloads do
      for (extraName, extra) in extras do
        let result := mapVerdict marker payload extra
        let bits := if result = .vector then vectorBits payload else []
        IO.println ("\t".intercalate ["vector", markerName, payloadName, extraName,
          verdict result, if bits.isEmpty then "-" else ",".intercalate (bits.map toString)])
  for seconds in [minSeconds - 1, minSeconds, 0, maxSeconds, maxSeconds + 1] do
    for nanos in [-1, 0, 1, nanosPerSecond - 1, nanosPerSecond] do
      IO.println ("\t".intercalate ["timestamp", toString seconds, toString nanos,
        verdict (timestamp seconds nanos)])
  for (lat, latitude) in coordinates do
    for (lon, longitude) in coordinates do
      IO.println ("\t".intercalate ["geo", lat, lon, verdict (geo latitude longitude)])
  for shape in ["array", "map", "alternating"] do
    for leaf in ["null", "vector"] do
      for depth in [0, 1, 19, 20, 21] do
        IO.println ("\t".intercalate ["container", shape, leaf, toString depth,
          verdict (container depth)])
