import EventarcWireSize

open EWS

def outcomeName : Verdict → String
  | .deliver => "deliver"
  | .eventCount => "event-count"
  | .eventSize => "event-size"
  | .binary => "binary"

def payloadAt (target : Nat) : IO Nat := do
  let estimates := (List.range 201).map ((eventLimit - 200) + ·)
  match estimates.find? (fun n => anySize n == target) with
  | some n => pure n
  | none => throw (IO.userError s!"no payload of Any size {target}")

def main : IO Unit := do
  IO.println "# Eventarc protobuf wire lengths and publish outcomes"
  let widths := (List.range 9).flatMap fun i =>
    let edge := 128 ^ (i + 1)
    [edge - 1, edge, edge + 1]
  for n in [0, 1] ++ widths ++ [18446744073709551615] do
    IO.println s!"v|{n}|{varintLen n}"
  for n in [0, 1, 126, 127, 128, 129, 16383, 16384, 524287, 524288] do
    IO.println s!"f|{n}|{fieldLen n}"
  let below ← payloadAt (eventLimit - 1)
  let exact ← payloadAt eventLimit
  let above ← payloadAt (eventLimit + 1)
  for (data, representation) in [("ascii", Representation.ascii), ("unicode", .unicode), ("binary", .binary)] do
    for (edge, payload) in [("small", 18), ("below", below), ("exact", exact), ("above", above)] do
      for (label, peers) in [("none", 0), ("one", 1), ("at-limit", 99), ("full", 100)] do
        IO.println s!"p|{data}|{edge}|{label}|{payload}|{outcomeName (verdict representation payload peers)}|{requestSize payload peers}"
