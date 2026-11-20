import Std

namespace PMI

def first : Nat := 22_250_000_000_000_000
def span : Nat := 10_000_000_000_000
def half : Nat := 5_000_000_000_000
def stride : Nat := 6_180_339_887_499

def offset (counter : Nat) : Nat := (counter * stride) % span

def brokerId (counter : Nat) : Nat := first + offset counter

def runtimeSlot (counter : Nat) : Nat := half + (max counter 1 - 1) % half + 1

def runtimeId (counter : Nat) : Nat := brokerId (runtimeSlot counter)

def position (previous count : Nat) : Nat := (previous + count) % half

/-- Session word mixing uses wrapping 64-bit arithmetic. -/
def mix (seed : BitVec 64) : BitVec 64 :=
  let x := seed + 0x9e3779b97f4a7c15
  let y := (x ^^^ (x >>> 30)) * 0xbf58476d1ce4e5b9
  let z := (y ^^^ (y >>> 27)) * 0x94d049bb133111eb
  z ^^^ (z >>> 31)

/-- One addition is enough because a multiple of five plus two is not a multiple of five. -/
def adjust (odd : Nat) : Nat :=
  if odd % 5 = 0 then odd + 2 else odd

def affineParams (session : Nat) : Nat × Nat :=
  let folded := mix (BitVec.ofNat 64 session) + BitVec.ofNat 64 (session / 2 ^ 64)
  let odd := mix folded ||| 1
  let multiplier := adjust odd.toNat % half
  let addend := (mix (folded + 0x9e3779b97f4a7c15)).toNat % half
  (multiplier, addend)

def affineSlot (multiplier addend counter : Nat) : Nat :=
  half + (multiplier * counter + addend) % half + 1

def seededRuntimeId (session counter : Nat) : Nat :=
  let (multiplier, addend) := affineParams session
  brokerId (affineSlot multiplier addend counter)

end PMI
