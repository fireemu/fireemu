import Std

namespace WC

def nibble (n : Nat) : Option Nat :=
  if 48 ≤ n && n ≤ 57 then some (n - 48)
  else if 65 ≤ n && n ≤ 70 then some (n - 55)
  else if 97 ≤ n && n ≤ 102 then some (n - 87)
  else none

def byte (a b : Nat) : Option Nat := do
  let hi ← nibble a
  let lo ← nibble b
  return 16 * hi + lo

def hexDecode : List Nat → Option (List Nat)
  | [] => some []
  | a :: b :: rest => List.cons <$> byte a b <*> hexDecode rest
  | [_] => none

/-- Translate a byte stream and report whether every percent began a valid escape. -/
def percent (space : Bool) : List Nat → Bool × List Nat
  | [] => (true, [])
  | 37 :: a :: b :: rest =>
    match byte a b with
    | some v =>
      let (valid, bytes) := percent space rest
      (valid, v :: bytes)
    | none => (false, 37 :: (percent space (a :: b :: rest)).2)
  | 37 :: rest => (false, 37 :: (percent space rest).2)
  | b :: rest =>
    let (valid, bytes) := percent space rest
    (valid, (if space && b == 43 then 32 else b) :: bytes)

def hexDigit (n : Nat) : Char :=
  Char.ofNat (if n < 10 then 48 + n else 87 + n)

def hexByte (n : Nat) : List Char := [hexDigit (n / 16), hexDigit (n % 16)]

def escapeChar (short : Bool) (c : Char) : List Char :=
  match c with
  | '"' => ['\\', '"']
  | '\\' => ['\\', '\\']
  | '\n' => ['\\', 'n']
  | '\r' => ['\\', 'r']
  | '\t' => ['\\', 't']
  | c =>
    if short && c.toNat == 8 then ['\\', 'b']
    else if short && c.toNat == 12 then ['\\', 'f']
    else if c.toNat < 32 then ['\\', 'u', '0', '0'] ++ hexByte c.toNat
    else [c]

def escape (short : Bool) (chars : List Char) : List Char :=
  chars.flatMap (escapeChar short)

end WC
