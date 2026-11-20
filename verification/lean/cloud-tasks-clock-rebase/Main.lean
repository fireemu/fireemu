import CloudTasksClockRebase

open CTRebase

def main : IO Unit := do
  IO.println "# own|other|scheduled|own_ns|other_ns|scheduled_ns|result_ns"
  for (ownLabel, own) in points do
    for (otherLabel, other) in points do
      for (atLabel, instant) in points do
        IO.println s!"{ownLabel}|{otherLabel}|{atLabel}|{own}|{other}|{instant}|{translate instant own other}"
