import AuthPhoneNormalization

open AuthPhoneNormalization

def numerals (input : List Char) : String :=
  if input.isEmpty then "-" else String.intercalate "," (input.map (fun c => toString c.toNat))

def edit (flavor : String) (leading raw : List Char) : List Char :=
  match flavor with
  | "space" => leading ++ ' ' :: raw
  | "punctuation" => leading ++ raw.flatMap fun c => [c, '-', '(', ')', '.', '/']
  | "tab" => leading ++ '\t' :: raw
  | "fullwidth" => leading ++ '７' :: raw
  | "lineBreak" => leading ++ raw ++ ['\n']
  | "extraPlus" => leading ++ '+' :: raw
  | _ => leading ++ raw

def main : IO Unit := do
  IO.println "# prefix|length|head|edit|input scalars|validate|normalized"
  for (label, leading) in [("plus", "+"), ("none", ""), ("spacePlus", " +"), ("double", "++")] do
    for length in [0, 1, 6, 7, 15, 16] do
      for (headLabel, head) in [("zero", '0'), ("nonzero", '1'), ("upper", 'T'), ("lower", 'z')] do
        for flavor in ["plain", "space", "punctuation", "tab", "fullwidth", "lineBreak", "extraPlus"] do
          let raw := if length == 0 then [] else head :: (List.range (length - 1)).map
            (fun i => Char.ofNat ('0'.toNat + i % 10))
          let input := edit flavor leading.toList raw
          let passed := if validate input then "true" else "false"
          let normalized := (normalize input).map String.ofList |>.getD "-"
          IO.println (String.intercalate "|" [label, toString length, headLabel, flavor, numerals input, passed, normalized])
  for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".toList do
    let input := ['+', '1', '2', '3', '4', '5', letter, '6']
    let normalized := (normalize input).map String.ofList |>.getD "-"
    IO.println (String.intercalate "|" ["plus", "7", String.ofList [letter], "vanity", numerals input, "false", normalized])
