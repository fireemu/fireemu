import RtdbPushId
open RtdbPushId

def times : List (String × Nat) := [("usual", 1000), ("boundary", timeBase - 2), ("wrap", timeBase - 1)]
def tails : List (String × Nat) := [("plain", 72), ("carry", 64 ^ 5 - 1), ("full", tailBase - 1)]
def clocks : List (String × (Nat → Nat)) := [("later", (· + 1)), ("same", id), ("earlier", (· - 1))]

def main : IO Unit := do
  for (clock, request) in clocks do
    for (suffix, tail) in tails do
      for (bound, time) in times do
        for seed in ([0, 3, 18446744073709551615] : List UInt64) do
          let before := (time, tail)
          let requested := request time
          let after := next before requested (seededTail seed)
          let tailText := String.ofList ((digits tail 12).map (fun digit => alphabet.toList[digit]!))
          IO.println <| "\t".intercalate [clock, suffix, bound, toString time, tailText, toString (seed.toNat), toString requested, render before, render after]
