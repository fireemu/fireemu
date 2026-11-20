import LogWebsocketFrame

open LogWebsocketFrame

private def hex (bytes : List Nat) : String :=
  if bytes.isEmpty then "-" else
    let digits := "0123456789abcdef".toList
    String.ofList (bytes.flatMap fun byte => [digits[byte / 16]!, digits[byte % 16]!])

private def payload (shape : String) (length : Nat) : List Nat :=
  if shape == "zero" then List.replicate length 0
  else if shape == "ff" then List.replicate length 255
  else (List.range length).map fun index => (index * 31 + 17) % 256

def main : IO Unit := do
  let mut rows := #[]
  for length in [0, 1, 125, 126, 127, 255, 256, 65534, 65535, 65536, 65537] do
    for opcode in [1, 2, 8, 10, 242] do
      for shape in ["zero", "pattern", "ff"] do
        rows := rows.push s!"frame {length} {opcode} {shape} {hex (header opcode length)}"
  for text in ["", "hello", "ログ", "a😀"] do
    let bytes := text.toUTF8.data.toList.map UInt8.toNat
    rows := rows.push s!"text {hex bytes} {hex (header 1 bytes.length)}"
  let status := bigEndian 2 1000
  rows := rows.push s!"close {hex status} {hex (header 8 status.length)}"
  let keys : List (String × List Nat) :=
    [("zero", [0, 0, 0, 0]), ("uniform", [255, 255, 255, 255]),
      ("alternating", [85, 170, 85, 170]), ("distinct", [1, 10, 128, 254])]
  for length in [0, 1, 3, 4, 5, 9, 17] do
    for shape in ["zero", "pattern", "ff"] do
      for (keyName, key) in keys do
        let decoded := applyMask (fun position => key[position]!) 0 (payload shape length)
        rows := rows.push s!"mask {length} {shape} {keyName} {hex key} {hex decoded}"
  IO.println s!"# cases {rows.size}"
  for row in rows do IO.println row
