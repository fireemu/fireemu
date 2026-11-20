import WireCodecs

def toBytes (text : String) : List Nat :=
  text.toUTF8.data.toList.map UInt8.toNat

def hex (bytes : List Nat) : String :=
  String.ofList (bytes.flatMap WC.hexByte)

def emitPercent (label : String) (space : Bool) (context input : String) : IO Unit := do
  let source := toBytes input
  let (valid, decoded) := WC.percent space source
  let mode := if space then "form" else "literal"
  IO.println s!"p|{label}|{mode}|{context}|{hex source}|{hex decoded}|{valid}"

def emitHex (input : String) : IO Unit :=
  let source := toBytes input
  IO.println s!"h|{hex source}|{(WC.hexDecode source).map hex |>.getD "!"}"

def main : IO Unit := do
  IO.println "# percent, hex and JSON cases"
  for (kind, escape) in [
    ("upper", "%2F"), ("lower", "%2f"), ("bad-digit", "%2G"), ("bare-percent", "%"),
    ("short", "%A"), ("bad-plus", "%+f"), ("recursive", "%2541"), ("plain", "+")
  ] do
    for space in [false, true] do
      for (context, contextText) in [("empty", ""), ("ascii", "a+"), ("unicode", "π+")] do
        emitPercent kind space context (contextText ++ escape)
  for n in List.range 256 do
    emitPercent "byte" false "bounded" ("%" ++ String.ofList (WC.hexByte n))
    emitHex (String.ofList (WC.hexByte n))
  for input in ["", "AB", "aB", "abc", "+a", "-a", " a", "π", "G0"] do
    emitHex input
  for short in [false, true] do
    let dialect := if short then "short" else "unicode"
    for c in (List.range 32).map Char.ofNat ++ ['"', '\\', 'π', '😀'] do
      let source := String.ofList ['a', c, 'z']
      let escaped := String.ofList (WC.escape short source.toList)
      IO.println s!"j|{dialect}|{hex (toBytes source)}|{hex (toBytes escaped)}"
