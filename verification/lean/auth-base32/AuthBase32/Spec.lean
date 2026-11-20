import Std

namespace AuthBase32

private def alphabet := "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".toList

def bits (width number : Nat) : List Bool :=
  (List.range width).reverse.map fun power => (number / 2 ^ power) % 2 = 1

def number (stream : List Bool) : Nat :=
  stream.foldl (fun value bit => value * 2 + if bit then 1 else 0) 0

def paddedGroups (width : Nat) (stream : List Bool) : List Nat :=
  (List.range ((stream.length + width - 1) / width)).map fun index =>
    let block := (stream.drop (index * width)).take width
    number (block ++ List.replicate (width - block.length) false)

def fullGroups (width : Nat) (stream : List Bool) : List Nat :=
  (List.range (stream.length / width)).map fun index =>
    number ((stream.drop (index * width)).take width)

def padding (symbols : Nat) : Nat :=
  (8 - symbols % 8) % 8

def encode (octets : List Nat) : String :=
  let values := paddedGroups 5 (octets.flatMap (bits 8))
  String.ofList (values.map (fun n => alphabet[n]?.getD '?') ++
    List.replicate (padding values.length) '=')

def beforePadding : List Char → List Char
  | [] => []
  | head :: tail => if head = '=' then [] else head :: beforePadding tail

def alphabetValue (character : Char) : Option Nat :=
  alphabet.idxOf? character.toUpper

def symbols : Nat → List Char → Except Nat (List Nat)
  | _, [] => .ok []
  | offset, head :: tail => do
      let some value := alphabetValue head | .error offset
      let remaining ← symbols (offset + 1) tail
      pure (value :: remaining)

def decode (encoded : List Char) : Except Nat (List Nat) := do
  let values ← symbols 0 (beforePadding encoded)
  pure (fullGroups 8 (values.flatMap (bits 5)))

end AuthBase32
