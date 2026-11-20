import Std

namespace AuthPhoneNormalization

def digit (c : Char) : Bool := decide ('0'.toNat ≤ c.toNat) && decide (c.toNat ≤ '9'.toNat)
def separator (c : Char) : Bool := [' ', '-', '(', ')', '.', '/'].contains c

def keypad : List (List Char × Char) :=
  [(['A', 'B', 'C', 'a', 'b', 'c'], '2'), (['D', 'E', 'F', 'd', 'e', 'f'], '3'), (['G', 'H', 'I', 'g', 'h', 'i'], '4'), (['J', 'K', 'L', 'j', 'k', 'l'], '5'),
   (['M', 'N', 'O', 'm', 'n', 'o'], '6'), (['P', 'Q', 'R', 'S', 'p', 'q', 'r', 's'], '7'), (['T', 'U', 'V', 't', 'u', 'v'], '8'), (['W', 'X', 'Y', 'Z', 'w', 'x', 'y', 'z'], '9')]

def translated (c : Char) : Option Char :=
  if digit c then some c
  else (keypad.find? (fun row => row.1.contains c)).map Prod.snd

def collect : List Char → Option (List Char)
  | [] => some []
  | c :: cs =>
    if separator c then collect cs
    else do
      let d ← translated c
      let ds ← collect cs
      pure (d :: ds)

def validDigits (digits : List Char) : Bool :=
  decide (7 ≤ digits.length) && decide (digits.length ≤ 15) && digits.all digit

def validate : List Char → Bool
  | '+' :: digits => validDigits digits
  | _ => false

/-- A formatted phone must begin at a literal plus, then normalize to canonical decimal digits. -/
def normalize (phone : List Char) : Option (List Char) :=
  match phone with
  | '+' :: suffix =>
    match collect suffix with
    | none => none
    | some digits =>
      if (digits.head? != some '0') && validDigits digits then some ('+' :: digits) else none
  | _ => none

end AuthPhoneNormalization
