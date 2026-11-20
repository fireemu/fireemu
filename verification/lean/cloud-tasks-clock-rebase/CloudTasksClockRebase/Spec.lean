import Std

namespace CTRebase

def lower : Int := -(2 ^ 127)
def upper : Int := 2 ^ 127 - 1

def clip (n : Int) : Int := min upper (max lower n)

/-- The largest signed distance also represents the magnitude of the minimum signed value. -/
def distance (instant clock : Int) : Int := min upper ((clip (instant - clock)).natAbs : Int)

def translate (instant own other : Int) : Int :=
  if distance instant other < distance instant own then clip (clip (instant - other) + own) else instant

def points : List (String × Int) :=
  [("min", lower), ("minPlusOne", lower + 1), ("negative", -100), ("zero", 0),
   ("middle", 50), ("positive", 100), ("maxMinusOne", upper - 1), ("max", upper)]

end CTRebase
