import Std

namespace DIS

abbrev Word := BitVec 64

def increment : Word := 0x9e3779b97f4a7c15
def mulA : Word := 0xbf58476d1ce4e5b9
def mulB : Word := 0x94d049bb133111eb

def scramble (w : Word) (shift : Nat) : Word := w ^^^ (w >>> shift)

/-- The SplitMix64 output permutation after advancing the seed by one step. -/
def mix (seed : Word) : Word :=
  let a := scramble (seed + increment) 30 * mulA
  let b := scramble a 27 * mulB
  scramble b 31

def draw (seed : Word) (index : Nat) : Word :=
  mix (seed + increment * BitVec.ofNat 64 index)

def rejectionZone (bound : Nat) : Nat :=
  let last := 2 ^ 64 - 1
  last - last % bound

/-- Projection of bounded rejection sampling onto a supplied sequence of random words. -/
def selectBelow (bound : Nat) (words : List Word) : Option Nat :=
  if bound ≤ 1 then some 0 else
    (words.find? (fun word => decide (word.toNat < rejectionZone bound))).map
      (fun word => word.toNat % bound)

inductive Kind where
  | command | event | invocation | transaction | correlation
  deriving DecidableEq

def Kind.tag : Kind → Word
  | .command => 0
  | .event => 1
  | .invocation => 2
  | .transaction => 3
  | .correlation => 4

def Kind.code : Kind → String
  | .command => "c"
  | .event => "e"
  | .invocation => "i"
  | .transaction => "t"
  | .correlation => "r"

def upper (lo hi seed : Word) (kind : Kind) : Word :=
  mix (lo ^^^ hi.rotateLeft 17 ^^^ seed ^^^ (kind.tag <<< 56))

def pack (a b : Word) : Nat :=
  a.toNat * 2 ^ 64 + b.toNat

def mixedId (lo hi seed : Word) (kind : Kind) (counter : Word) : Nat :=
  let key := upper lo hi seed kind
  pack key (mix (key ^^^ counter))

/-- The history oracle counts prior calls of this kind, regardless of their interleaving. -/
def projectedCount (kind : Kind) (history : List Kind) : Nat :=
  history.countP (fun call => decide (call = kind))

def nextId (lo hi seed : Word) (history : List Kind) (kind : Kind) : Nat :=
  let counter := BitVec.ofNat 64 (projectedCount kind history + 1)
  if kind = .command then counter.toNat else mixedId lo hi seed kind counter

end DIS
