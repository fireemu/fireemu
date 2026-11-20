import Std

namespace FirestoreWatchBloom

structure Layout where
  hashes : Int
  bytes : Nat
  padding : Int
  deriving DecidableEq, Repr

def recorded : Nat → Option Layout
  | 1 => some ⟨12, 3, 7⟩
  | 2 => some ⟨13, 5, 3⟩
  | 3 => some ⟨14, 8, 5⟩
  | _ => none

def bits (layout : Layout) : Nat := layout.bytes * 8 - layout.padding.toNat

def position (h1 h2 index capacity : Nat) : Nat :=
  ((h1 + index * h2) % (2^64)) % capacity

def indices (layout : Layout) (digest : Nat × Nat) : List Nat :=
  if bits layout = 0 then [] else
    (List.range layout.hashes.toNat).map fun i => position digest.1 digest.2 i (bits layout)

def present (layout : Layout) (names : List (Nat × Nat)) (bit : Nat) : Bool :=
  names.any fun digest => (indices layout digest).contains bit

def bitmap (layout : Layout) (names : List (Nat × Nat)) : List Nat :=
  (List.range layout.bytes).map fun byte =>
    ((List.range 8).filter (fun bit => present layout names (8 * byte + bit))).foldl
      (fun value bit => value + 2^bit) 0

end FirestoreWatchBloom
