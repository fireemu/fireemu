import ExportWire

open ExportWire

def hex (n : Nat) : Char :=
  if n < 10 then Char.ofNat (48 + n) else Char.ofNat (87 + n)

def bits (bytes : List Nat) : String :=
  String.ofList (bytes.flatMap fun byte => [hex (byte / 16), hex (byte % 16)])

def magnitude : List Nat :=
  [0, 1, unsignedSpace - 1] ++
    (List.range 9).flatMap fun k =>
      let threshold := 128 ^ (k + 1)
      [threshold - 1, threshold]

def canonicalRows : List (List String) :=
  [1, 15, 16, 536870911, 4294967295].flatMap fun field =>
    ["unsigned", "signed"].flatMap fun mode =>
      magnitude.map fun value =>
        let payload := if mode == "signed" then signedBits (asSigned value) else value
        ["write", toString field, mode, toString value, bits (fieldBytes field payload)]

def malformedInputs : List (List Nat) :=
  (List.range 11).flatMap (fun n => [
    List.replicate n 128,
    List.replicate n 128 ++ [0],
    List.replicate n 255 ++ [127]
  ]) ++ [
    [0, 255], [128, 0, 127], [129, 0], [255, 255, 0],
    [128, 1, 128], [255, 1, 0], [128, 128, 1], List.replicate 9 255 ++ [2, 42]
  ]

def inputRows : List (List String) := malformedInputs.map fun input =>
  let (value, used) := match decodeU64 input with
    | .value value used => (toString value, used)
    | .short used => ("short", used)
    | .long used => ("long", used)
  ["read", bits input, value, toString used]

def main : IO Unit := do
  IO.println "# write FIELD MODE U64 BITS, or read BITS EXPECTED CONSUMED, tab separated"
  for row in canonicalRows ++ inputRows do
    IO.println ("\t".intercalate row)
