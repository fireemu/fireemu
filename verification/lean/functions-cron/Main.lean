import FunctionsCron

open FunctionsCron

structure Example where
  label : String
  source : String
  rule : Rule

def allMinutes : List Nat := List.range 60
def allHours : List Nat := List.range 24

def examples : List Example :=
  [⟨"all", "* * * * *", .cron { minutes := allMinutes, hours := allHours }⟩,
   ⟨"quarter", "*/15 * * * *", .cron { minutes := [0, 15, 30, 45], hours := allHours }⟩,
   ⟨"dom", "0 0 2 * *", .cron { minutes := [0], hours := [0], dom := some 2 }⟩,
   ⟨"dow", "0 0 * * mon", .cron { minutes := [0], hours := [0], dow := some 1 }⟩,
   ⟨"either", "0 0 2 * mon", .cron { minutes := [0], hours := [0], dom := some 2, dow := some 1 }⟩,
   ⟨"sun", "0 0 * * 7", .cron { minutes := [0], hours := [0], dow := some 0 }⟩,
   ⟨"jan", "0 0 31 jan *", .cron { minutes := [0], hours := [0], dom := some 31, month := some 1 }⟩,
   ⟨"interval", "every 7 minutes", .interval 420⟩]

def optionSeconds (seconds : Option Int) : String := seconds.map toString |>.getD "-"

def row (label : String) (spec : Example) (offset start stop : Int) (cap horizon : Nat) : String :=
  let after := (candidates spec.rule start offset horizon).filter (fun sec => start < sec * nanosPerSecond)
  let runs := withinWindow start stop after
  let firstFive := if runs.isEmpty then "-" else String.intercalate "," ((runs.take 5).map toString)
  let interval := match spec.rule with
    | .interval _ => true
    | .cron _ => false
  let (exact, count) := countRuns interval cap runs.length
  String.intercalate "\t"
    [label, spec.source, toString offset, toString start, toString stop, toString cap,
     optionSeconds after.head?, optionSeconds runs.getLast?, (if exact then "exact" else "atleast"),
     toString count, firstFive]

def main : IO Unit := do
  let matrix := examples.flatMap fun item =>
    [("utc", 0), ("west", -18_000), ("historical", 19_801)].flatMap fun (zone, offset) =>
      [("before", -1), ("at", 0), ("after", 1)].flatMap fun (phase, fudge) =>
        [0, 1, 3, 20].map fun cap =>
          let anchor := (86_400 - offset) * nanosPerSecond
          let horizon := if item.label == "dom" || item.label == "jan" then 35 else 9
          row s!"{item.label}/{zone}/{phase}/{cap}" item offset
            (anchor + fudge) (anchor + 7 * 86_400 * nanosPerSecond) cap horizon
  let seven : Example := ⟨"interval", "every 7 minutes", .interval 420⟩
  let midnight : Example := ⟨"month", "0 0 1 * *", .cron { minutes := [0], hours := [0], dom := some 1 }⟩
  let extras :=
    [row "negative-epoch" seven 19_801 (-840 * nanosPerSecond - 1) 1 0 1,
     row "exact-negative-epoch" seven (-18_000) (-840 * nanosPerSecond) 0 1 1,
     row "reversed" seven 0 1000 0 1 1,
     row "same-second" seven 0 1 999 1 1,
     row "month-end" midnight 19_801
       ((31 * 86_400 - 19_801) * nanosPerSecond - 1)
       ((31 * 86_400 - 19_801) * nanosPerSecond) 0 2]
  let rows := matrix ++ extras
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
