import SchedulerRetryPolicy

open SRP

def deadlineNanos (policy : Policy) : Int :=
  Int.ofNat (policy.windowSeconds.getD 0 * nanosPerSecond)

def probe (policy : Policy) (attempt : Nat) : String :=
  let gap := delay policy attempt
  let elapsed := [0, deadlineNanos policy - Int.ofNat gap, Int.ofNat i128Max - 1]
  let answers := elapsed.flatMap fun n => [allows policy attempt n, allows policy attempt (n + 1)]
  let bits := String.ofList (answers.map (fun answer => if answer then '1' else '0'))
  s!"{attempt},{gap},{bits}"

def probes (policy : Policy) : String :=
  String.intercalate ";" <| [0, 1, 2, 3, 4, 6, 7, 121, u32Max].map (probe policy)

def main : IO Unit := do
  IO.println "# Scheduler retry projection and decision probes"
  for (gen, generation) in [("first", Generation.first), ("second", .second)] do
    for (countName, count) in [("zero", 0), ("one", 1), ("five", 5), ("six", 6), ("saturated", u32Max)] do
      for (windowName, window) in [("none", 0), ("normal", 20), ("saturated", 18446744073709551615)] do
        for (backoffName, minimum, maximum) in [
          ("defaults", 0, 0), ("min-only", 3, 0), ("max-only", 0, 10),
          ("reversed", 7, 6), ("ordinary", 4, 20), ("saturated", i64Max + 1, 18446744073709551615)
        ] do
          for (doublingName, doublings) in [("zero", 0), ("one", 1), ("many", 128)] do
            let config : Config := ⟨count, window, minimum, maximum, doublings⟩
            let policy := project generation config
            IO.println s!"{gen}|{countName}|{windowName}|{backoffName}|{doublingName}|{count}|{window}|{minimum}|{maximum}|{doublings}|{policy.attempts}|{policy.minimum}|{policy.maximum}|{refusesJob config}|{deadlineNanos policy}|{probes policy}"
