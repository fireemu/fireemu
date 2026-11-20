import Std

namespace AA

inductive Classification where
  | connection
  | resources
  | fatal
  deriving DecidableEq, Repr

/-- The effective schedule, with the repeated zero/first delay and final plateau. -/
def backoff (failures : Nat) : Nat :=
  if failures ≤ 1 then 100 else if failures = 2 then 200
  else if failures = 3 then 400 else if failures = 4 then 800 else 1000

/-- Portable error kinds, separated from the host OS's raw numeric error codes. -/
def portable (kind : String) : Classification :=
  if ["aborted", "reset", "refused", "interrupted", "down", "network", "host"].contains kind then
    .connection
  else if kind == "memory" then .resources else .fatal

end AA
