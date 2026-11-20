import Std

namespace SnapshotLifetime

def week : Int := 604800000000000
def hour : Int := 3600000000000

def age (published : Option Int) (now : Int) : Int :=
  match published with
  | none => 0
  | some earlier => max 0 (now - earlier)

def durationForAge (elapsed : Int) : Option Int :=
  if elapsed > week - hour then none else some (week - elapsed)

def duration (oldestUnacknowledged : Option Int) (now : Int) : Option Int :=
  durationForAge (age oldestUnacknowledged now)

def expiry (oldestUnacknowledged : Option Int) (now : Int) : Option Int :=
  (duration oldestUnacknowledged now).map (now + ·)

def visible (expires : Option Int) (atTime : Int) : Bool :=
  expires.isSome && atTime < expires.getD atTime

end SnapshotLifetime
