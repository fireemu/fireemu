import AuthBase32

open AuthBase32

private def field (text : String) : String := if text.isEmpty then "-" else text

private def hex (octets : List Nat) : String :=
  let digits := "0123456789abcdef".toList
  field (String.ofList (octets.flatMap fun n => [digits[n / 16]!, digits[n % 16]!]))

private def payloads : List (Nat × List Nat) :=
  [ (0, []), (1, [102]), (2, [102, 111]), (3, [102, 111, 111])
  , (4, [102, 111, 111, 98]), (5, [102, 111, 111, 98, 97]), (6, [102, 111, 111, 98, 97, 114]) ]

private def encodedPayload (style : String) (source : String) : String :=
  if style == "lower" then source.toLower
  else if style == "mixed" then String.ofList (source.toList.zipIdx.map fun (c, i) =>
    if i % 2 == 0 then c.toLower else c)
  else source

private def applySuffix (suffix : String) (padded : String) : String :=
  let plain := String.ofList (beforePadding padded.toList)
  match suffix with
  | "padded" => padded
  | "unpadded" => plain
  | "ignored" => plain ++ "=!é"
  | "invalid" => plain ++ "!=A"
  | _ => plain ++ "Z"

private def encodeRow (payload : List Nat) : String :=
  s!"encode {hex payload} {field (encode payload)}"

private def decodeRow (size style suffix text : String) : String :=
  let result := match decode text.toList with
    | .ok payload => s!"ok {hex payload}"
    | .error offset => s!"error {offset}"
  s!"decode {size} {style} {suffix} {field text} {result}"

def main : IO Unit := do
  let mut rows := ((List.range 256).map fun n => encodeRow [n]).toArray
  rows := rows ++ (payloads.map fun (_, values) => encodeRow values).toArray
  rows := rows.push (encodeRow (List.range 256))
  for (size, values) in payloads do
    for style in ["upper", "lower", "mixed"] do
      for suffix in ["padded", "unpadded", "ignored", "invalid", "residual"] do
        let text := applySuffix suffix (encodedPayload style (encode values))
        rows := rows.push (decodeRow (toString size) style suffix text)
  for text in ["A", "MZ", "é", "ABCé", "A0", "=", "===!", "MY=ignored", "MZ=ignored",
    "MY=======", "abcdefghijklmnopqrstuvwxyz234567"] do
    rows := rows.push (decodeRow "literal" "literal" "literal" text)
  IO.println s!"# cases {rows.size}"
  for row in rows do IO.println row
