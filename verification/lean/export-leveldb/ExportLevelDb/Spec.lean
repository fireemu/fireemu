import Std

namespace ExportLevelDb

def blockSize : Nat := 32768
def headerSize : Nat := 7
def capacity : Nat := blockSize - headerSize

/-- The physical type byte and payload size, or a block's zero-filled trailer. -/
inductive Piece where
  | padding (size : Nat)
  | full (size : Nat)
  | first (size : Nat)
  | middle (size : Nat)
  | last (size : Nat)
  deriving Repr, DecidableEq

def Piece.payload : Piece → Nat
  | .padding _ => 0
  | .full n | .first n | .middle n | .last n => n

def Piece.width : Piece → Nat
  | .padding n => n
  | p => headerSize + p.payload

def room (offset : Nat) : Nat :=
  blockSize - offset % blockSize

def paddingAt (offset : Nat) : List Piece :=
  if room offset < headerSize then [.padding (room offset)] else []

def firstCapacity (offset : Nat) : Nat :=
  if room offset < headerSize then capacity else room offset - headerSize

/-- The boundaries after FIRST are fixed-size payload slices of whole blocks. Fuel
    bounds the reference's recursion and is initialized to the logical record size. -/
def chunks : Nat → Nat → List Nat
  | 0, size => [size]
  | fuel + 1, size =>
    if size ≤ capacity then [size] else capacity :: chunks fuel (size - capacity)

def continuation : List Nat → List Piece
  | [] => []
  | [size] => [.last size]
  | size :: next :: rest => .middle size :: continuation (next :: rest)

/-- The physical layout of one logical record from its starting file offset. -/
def layout (offset length : Nat) : List Piece :=
  let first := firstCapacity offset
  paddingAt offset ++
    if length ≤ first then [.full length]
    else .first first :: continuation (chunks length (length - first))

def layouts (offset : Nat) : List Nat → List Piece
  | [] => []
  | length :: rest =>
    let record := layout offset length
    record ++ layouts (offset + (record.map Piece.width).sum) rest

end ExportLevelDb
