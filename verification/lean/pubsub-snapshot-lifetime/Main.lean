import PubsubSnapshotLifetime

open SnapshotLifetime

def base : Int := 1000000000000000

def ages : List (String × Int) :=
  [("future", -1), ("current", 0), ("recent", 1000000000),
   ("younger", week - hour - 1), ("exact", week - hour), ("older", week - hour + 1),
   ("seven-days", week), ("too-old", week + 1)]

def backlogKind : List String :=
  ["empty", "pending", "acked", "retained-acked", "mixed"]

def main : IO Unit := do
  IO.println "# age class|age(ns)|backlog|now(ns)|lookup offset|lookup at(ns)|expiry(ns)|visible"
  for (ageName, ageNanos) in ages do
    for backlog in backlogKind do
      let oldest := if backlog == "pending" then some (base - ageNanos)
        else if backlog == "mixed" then some (base - 1) else none
      let expires := expiry oldest base
      for offset in ([-1, 0, 1] : List Int) do
        let lookup := expires.getD base + offset
        let result := expires.map toString |>.getD "-"
        IO.println s!"{ageName}|{ageNanos}|{backlog}|{base}|{offset}|{lookup}|{result}|{visible expires lookup}"
