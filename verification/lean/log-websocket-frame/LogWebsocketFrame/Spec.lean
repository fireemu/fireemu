import Std

namespace LogWebsocketFrame

def bigEndian : Nat → Nat → List Nat
  | 0, _ => []
  | width + 1, value => (value / 256 ^ width % 256) :: bigEndian width value

def lengthField (length : Nat) : List Nat :=
  if length < 126 then [length]
  else if length < 65536 then 126 :: bigEndian 2 length
  else 127 :: bigEndian 8 length

def header (opcode length : Nat) : List Nat :=
  (128 + opcode % 16) :: lengthField length

def frame (opcode : Nat) (payload : List Nat) : List Nat :=
  header opcode payload.length ++ payload

def applyMask (key : Nat → Nat) (position : Nat) : List Nat → List Nat
  | [] => []
  | byte :: rest =>
    (byte ^^^ key (position % 4)) :: applyMask key (position + 1) rest

end LogWebsocketFrame
