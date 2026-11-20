import TotpWindow

/-!
# Golden corpus generator

The header declares the case count. Each remaining line uses the space-separated fields shown below.

    step <period> <nanos> <counter>
    validity <period> <nanos> <remaining seconds>
    mac <key> <counter> <20 digest bytes as hex>
    hotp <key> <period> <nanos> <digits> <counter> <code> <display>
    match <key> <period> <nanos> <digits> <window> <last> <code> <result>
    window <current> <window> <last> <matching counters> <result>

Periods are in seconds and instants are signed Unix nanoseconds. Numbers are decimal except for the MAC bytes. The keys are the public RFC SHA-1 test input (`rfc`) and the empty input (`empty`, treated as detached by `match`). The last accepted counter is `-` when absent. Matching counters are comma-separated, with `-` for the empty list. Results are `accepted:<counter>`, `replayed` or `no-match`.
-/

open TW

-- HMAC-SHA1 outputs for the public ASCII input "12345678901234567890" and big-endian
-- counters, computed with Python's stdlib HMAC. Lean computes all truncation and decimal output.
def rfcMacs : List (UInt64 × Digest) := [
  (0, #v[0xcc, 0x93, 0xcf, 0x18, 0x50, 0x8d, 0x94, 0x93, 0x4c, 0x64, 0xb6, 0x5d, 0x8b, 0xa7, 0x66, 0x7f, 0xb7, 0xcd, 0xe4, 0xb0]),
  (1, #v[0x75, 0xa4, 0x8a, 0x19, 0xd4, 0xcb, 0xe1, 0x00, 0x64, 0x4e, 0x8a, 0xc1, 0x39, 0x7e, 0xea, 0x74, 0x7a, 0x2d, 0x33, 0xab]),
  (2, #v[0x0b, 0xac, 0xb7, 0xfa, 0x08, 0x2f, 0xef, 0x30, 0x78, 0x22, 0x11, 0x93, 0x8b, 0xc1, 0xc5, 0xe7, 0x04, 0x16, 0xff, 0x44]),
  (3, #v[0x66, 0xc2, 0x82, 0x27, 0xd0, 0x3a, 0x2d, 0x55, 0x29, 0x26, 0x2f, 0xf0, 0x16, 0xa1, 0xe6, 0xef, 0x76, 0x55, 0x7e, 0xce]),
  (4, #v[0xa9, 0x04, 0xc9, 0x00, 0xa6, 0x4b, 0x35, 0x90, 0x98, 0x74, 0xb3, 0x3e, 0x61, 0xc5, 0x93, 0x8a, 0x8e, 0x15, 0xed, 0x1c]),
  (5, #v[0xa3, 0x7e, 0x78, 0x3d, 0x7b, 0x72, 0x33, 0xc0, 0x83, 0xd4, 0xf6, 0x29, 0x26, 0xc7, 0xa2, 0x5f, 0x23, 0x8d, 0x03, 0x16]),
  (6, #v[0xbc, 0x9c, 0xd2, 0x85, 0x61, 0x04, 0x2c, 0x83, 0xf2, 0x19, 0x32, 0x4d, 0x3c, 0x60, 0x72, 0x56, 0xc0, 0x32, 0x72, 0xae]),
  (7, #v[0xa4, 0xfb, 0x96, 0x0c, 0x0b, 0xc0, 0x6e, 0x1e, 0xab, 0xb8, 0x04, 0xe5, 0xb3, 0x97, 0xcd, 0xc4, 0xb4, 0x55, 0x96, 0xfa]),
  (8, #v[0x1b, 0x3c, 0x89, 0xf6, 0x5e, 0x6c, 0x9e, 0x88, 0x30, 0x12, 0x05, 0x28, 0x23, 0x44, 0x3f, 0x04, 0x8b, 0x43, 0x32, 0xdb]),
  (9, #v[0x16, 0x37, 0x40, 0x98, 0x09, 0xa6, 0x79, 0xdc, 0x69, 0x82, 0x07, 0x31, 0x0c, 0x8c, 0x7f, 0xc0, 0x72, 0x90, 0xd9, 0xe5]),
  (12, #v[0x1a, 0xda, 0xf4, 0xb0, 0xbf, 0x40, 0x46, 0xd0, 0x56, 0xd8, 0xf0, 0x0e, 0x4a, 0x6a, 0x96, 0xa3, 0x6b, 0xc9, 0x98, 0x07]),
  (14, #v[0x05, 0x6d, 0x10, 0xdc, 0x2c, 0x05, 0x20, 0x00, 0xcc, 0x4f, 0x95, 0xfd, 0xcf, 0xd9, 0x22, 0x04, 0x33, 0x72, 0xbe, 0x99]),
  (20, #v[0x88, 0xc9, 0xed, 0xe8, 0x59, 0x99, 0xe1, 0xb8, 0x0f, 0x99, 0x6f, 0x0e, 0x12, 0x14, 0xcf, 0x4e, 0xcc, 0x54, 0x17, 0x51]),
  (25, #v[0x0d, 0x3d, 0xc1, 0x4a, 0x6d, 0x0b, 0xa2, 0xbd, 0x03, 0x6d, 0x35, 0x32, 0x67, 0xed, 0x23, 0x97, 0xc7, 0xb7, 0x37, 0x52]),
  (28, #v[0x6a, 0xc0, 0x71, 0x59, 0x01, 0xa8, 0x46, 0x71, 0xa2, 0x81, 0x70, 0x9c, 0xbc, 0x94, 0xe8, 0xdd, 0xb3, 0xfb, 0x11, 0xe8]),
  (37037036, #v[0x27, 0x8c, 0x02, 0xe5, 0x36, 0x10, 0xf8, 0x4c, 0x40, 0xbd, 0x91, 0x35, 0xac, 0xd4, 0x10, 0x10, 0x12, 0x41, 0x0a, 0x14]),
  (37037037, #v[0xb0, 0x09, 0x2b, 0x21, 0xd0, 0x48, 0xaf, 0x20, 0x9d, 0xa0, 0xa1, 0xdd, 0xd4, 0x98, 0xad, 0xe8, 0xa7, 0x94, 0x87, 0xed]),
  (41152263, #v[0x90, 0x7c, 0xd1, 0xa9, 0x11, 0x65, 0x64, 0xec, 0xb9, 0xd5, 0xd1, 0x78, 0x03, 0x25, 0xf2, 0x46, 0x17, 0x3f, 0xe7, 0x03]),
  (66666666, #v[0x25, 0xa3, 0x26, 0xd3, 0x1f, 0xc3, 0x66, 0x24, 0x4c, 0xad, 0x05, 0x49, 0x76, 0x02, 0x0c, 0x7b, 0x56, 0xb1, 0x3d, 0x5f]),
  (666666666, #v[0xab, 0x07, 0xe9, 0x7e, 0x2c, 0x12, 0x78, 0x76, 0x9d, 0xbc, 0xd7, 0x57, 0x83, 0xaa, 0xbd, 0xe7, 0x5e, 0xd8, 0x55, 0x0a]),
  (18446744073709551614, #v[0x35, 0x11, 0x45, 0xcc, 0xdc, 0x07, 0x4c, 0xaa, 0x7f, 0xee, 0xc5, 0xd7, 0x3e, 0x91, 0xe7, 0xfb, 0xad, 0xfb, 0x32, 0xb3]),
  (18446744073709551615, #v[0xf6, 0x16, 0xfd, 0x66, 0xb7, 0xf0, 0x62, 0x90, 0x68, 0x6b, 0x63, 0x20, 0xce, 0xb3, 0x4d, 0x65, 0xb1, 0xfe, 0x93, 0xea])
]

#guard (List.range 16).all (fun i => rfcMacs.any (fun (_, digest) => offset digest == i))

def emptyMacs : List (UInt64 × Digest) := [
  (0, #v[0xda, 0xb6, 0x9a, 0xd9, 0x8e, 0x28, 0x76, 0x4f, 0x97, 0x7e, 0xe2, 0x48, 0x7e, 0x4f, 0x3f, 0x68, 0x73, 0xb2, 0xa2, 0x97])
]

def lookup (entries : List (UInt64 × Digest)) (message : List UInt8) : Option Digest :=
  (entries.find? fun (step, _) =>
    (([56, 48, 40, 32, 24, 16, 8, 0] : List UInt64).map fun shift => (step >>> shift).toUInt8) == message).map Prod.snd

def recordedHmac (entries : List (UInt64 × Digest)) : Hmac :=
  fun message => (lookup entries message).getD (Vector.replicate 20 0)

def rfcVectors : List (Int × String) :=
  [(59, "94287082"), (1111111109, "07081804"), (1111111111, "14050471"),
    (1234567890, "89005924"), (2000000000, "69279037"), (20000000000, "65353130")]

#guard rfcVectors.all (fun (seconds, want) =>
  showCode (recordedHmac rfcMacs) (timeStep 30 (seconds * nanosPerSecond)) 8 == want)

def hexDigit (n : Nat) : Char := "0123456789abcdef".toList[n % 16]!

def hexDigest (digest : Digest) : String :=
  String.ofList (digest.toList.flatMap fun byte => [hexDigit (byte.toNat / 16), hexDigit byte.toNat])

def steps : List String := Id.run do
  let mut rows := []
  for period in ([0, 1, 30, 60, 4294967295] : List Nat) do
    let stride := nanosPerSecond * (period : Int)
    let boundaries := if period = 0 then [0] else
      [-stride, 0, stride, 2 * stride, 4 * stride, (maxStep : Int) * stride, ((maxStep : Int) + 1) * stride]
    for nanos in [-(2 ^ 127), 2 ^ 127 - 1] ++ boundaries.flatMap (fun b => [b - 1, b, b + 1]) do
      rows := s!"step {period} {nanos} {timeStep period nanos}" :: rows
  return rows.reverse

def hotpRow (key : String) (entries : List (UInt64 × Digest)) (period digits : Nat)
    (nanos : Int) : Option String := do
  let step := timeStep period nanos
  let _ ← lookup entries (counterBytes step)
  let hmac := recordedHmac entries
  return s!"hotp {key} {period} {nanos} {digits} {step} {hotp hmac step digits} {showCode hmac step digits}"

def hotpRows : List (Option String) :=
  (List.range 256).map (fun digits => hotpRow "rfc" rfcMacs 30 digits 0) ++
  rfcMacs.flatMap (fun (step, _) => [1, 6, 8, 9, 10].map fun digits =>
    hotpRow "rfc" rfcMacs 30 digits ((step.toNat : Int) * nanosPerSecond * 30)) ++
  rfcVectors.map (fun (seconds, _) => hotpRow "rfc" rfcMacs 30 8 (seconds * nanosPerSecond)) ++
  [hotpRow "rfc" rfcMacs 0 6 nanosPerSecond, hotpRow "rfc" rfcMacs 60 6 (-1),
    hotpRow "rfc" rfcMacs 60 6 (2 ^ 127 - 1), hotpRow "empty" emptyMacs 30 6 0]

def encLast (last : Option Nat) : String := (last.map toString).getD "-"

def encMatch : CodeMatch → String
  | .accepted step => s!"accepted:{step}"
  | .replayed => "replayed"
  | .noMatch => "no-match"

def matchRow (detached : Bool) (period digits window : Nat) (last : Option Nat)
    (nanos : Int) (source : Nat) : Option String := do
  let entries := if detached then emptyMacs else rfcMacs
  let key := if detached then "empty" else "rfc"
  let _ ← lookup entries (counterBytes source)
  let current := timeStep period nanos
  if !detached && !(windowSteps current window).all (fun step => (lookup entries (counterBytes step)).isSome) then
    none
  else
    let hmac := recordedHmac entries
    let code := hotp hmac source digits
    return s!"match {key} {period} {nanos} {digits} {window} {encLast last} {code} {encMatch (matchCode hmac detached period digits window last code nanos)}"

def matchRows : List (Option String) := Id.run do
  let mut rows := []
  for period in ([30, 60] : List Nat) do
    let boundary := 4 * nanosPerSecond * (period : Int)
    for nanos in [boundary - 1, boundary, boundary + 1] do
      for (digits, window) in [(6, 1), (8, 2)] do
        for source in List.range 8 do
          rows := matchRow false period digits window none nanos source :: rows
  return rows.reverse ++ [
    matchRow false 30 6 1 (some 4) 120000000000 4,
    matchRow false 30 6 1 (some 4) 120000000000 5,
    matchRow false 30 0 1 (some 4) 120000000000 4,
    matchRow false 30 0 0 none 30000000000 2,
    matchRow false 30 0 0 (some 1) 30000000000 2,
    matchRow false 30 6 1 none (-1) 0,
    matchRow false 60 6 1 none (2 ^ 127 - 1) maxStep,
    matchRow true 30 6 0 none 0 0]

def windowRows : List String := Id.run do
  let mut rows := []
  for current in [0, 1, 300, maxStep - 1, maxStep] do
    for window in [0, 1, 2, 255] do
      let low := windowLow current window
      let high := windowHigh current window
      let outside := (if low = 0 then [] else [low - 1]) ++
        (if high = maxStep then [] else [high + 1])
      for (last, candidates) in [(none, [low]), (none, [high]), (none, outside),
          (none, [high, low]), (some low, [low, high]), (some high, [low, high])] do
        let encoded := if candidates.isEmpty then "-" else String.intercalate "," (candidates.map toString)
        let result := matchStepWindow current window last candidates.contains
        rows := s!"window {current} {window} {encLast last} {encoded} {encMatch result}" :: rows
  return rows.reverse

def validityRows : List String :=
  ([0, 1, 30, 60, 4294967295] : List Nat).flatMap fun period =>
    let stride := nanosPerSecond * Int.ofNat (max period 1)
    let instants := [-(2 ^ 127), 2 ^ 127 - 1, -1, 0, 1,
      stride - nanosPerSecond - 1, stride - nanosPerSecond,
      stride - 1, stride, stride + 1, 2 * stride]
    instants.map fun nanos => s!"validity {period} {nanos} {remainingValidity period nanos}"

def main : IO UInt32 := do
  let some concrete := (hotpRows ++ matchRows).mapM id
    | IO.eprintln "A corpus case needs an unrecorded digest"; return 1
  let macs := [("rfc", rfcMacs), ("empty", emptyMacs)].flatMap fun (key, entries) =>
    entries.map fun (step, digest) => s!"mac {key} {step} {hexDigest digest}"
  let rows := steps ++ validityRows ++ macs ++ concrete ++ windowRows
  IO.println "# Generated by verification/lean/totp-window (lake exe corpus). Do not edit."
  IO.println s!"# {rows.length} cases. Format: see Main.lean."
  for row in rows do IO.println row
  return 0
