import Std

namespace FunctionsProtocolFrame

abbrev Bytes := List Nat

def maxFrameBytes : Nat := 16 * 1024 * 1024
def maxDigits : Nat := 8

def bytes (s : String) : Bytes := s.toUTF8.data.toList.map UInt8.toNat

def encode (payload : Bytes) : Bytes :=
  bytes (toString payload.length) ++ [10] ++ payload

inductive Header where
  | eof
  | short
  | malformed
  | tooLarge
  | done (length : Nat) (rest : Bytes)
  deriving DecidableEq, Repr

/-- An incremental decimal prefix consumes exactly through the first newline. -/
def scan (digits length : Nat) : Bytes → Header
  | [] => if digits = 0 then .eof else .short
  | b :: rest =>
    if b = 10 ∧ digits > 0 then .done length rest
    else if 48 ≤ b ∧ b ≤ 57 ∧ digits < maxDigits then
      let next := length * 10 + (b - 48)
      if next > maxFrameBytes then .tooLarge else scan (digits + 1) next rest
    else .malformed

/-- Split at the stated byte offset, leaving the rest for the next frame. -/
def splitPayload (length : Nat) (wire : Bytes) : Option (Bytes × Bytes) :=
  if length ≤ wire.length then some (wire.take length, wire.drop length) else none

end FunctionsProtocolFrame
