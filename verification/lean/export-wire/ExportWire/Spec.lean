import Std

namespace ExportWire

def unsignedSpace : Nat := 18446744073709551616
def signBoundary : Nat := 9223372036854775808

/-- The two's-complement payload of a signed proto2 int64. -/
def signedBits (value : Int) : Nat :=
  (value % (unsignedSpace : Int)).toNat

def asSigned (bits : Nat) : Int :=
  if bits < signBoundary then bits else (bits : Int) - unsignedSpace

/-- Finite base-128 expansion with a one-byte representation for zero. -/
def digits : Nat → Nat → List Nat
  | 0, _ => []
  | fuel + 1, value =>
    let low := value % 128
    let quotient := value / 128
    if quotient = 0 then [low] else (low + 128) :: digits fuel quotient

/-- A read reports its total cursor consumption even when it fails. -/
inductive Read where
  | value (bits consumed : Nat)
  | short (consumed : Nat)
  | long (consumed : Nat)
  deriving Repr, DecidableEq

/-- Positional interpretation, from the high-order tail of the input. The final Rust
    reduction to 64 bits is a separate step, so overwide payloads appear explicitly. -/
def decode : Nat → List Nat → Read
  | 0, _ => .long 0
  | _ + 1, [] => .short 0
  | fuel + 1, byte :: tail =>
    if byte < 128 then .value byte 1
    else
      match decode fuel tail with
      | .value high used => .value (byte % 128 + 128 * high) (used + 1)
      | .short used => .short (used + 1)
      | .long used => .long (used + 1)

def decodeU64 (bytes : List Nat) : Read :=
  match decode 10 bytes with
  | .value bits used => .value (bits % unsignedSpace) used
  | failed => failed

def fieldBytes (number value : Nat) : List Nat :=
  digits 10 (8 * number) ++ digits 10 value

end ExportWire
