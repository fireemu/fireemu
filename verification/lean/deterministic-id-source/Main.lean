import DeterministicIdSource

open DIS

def sessions : List (String × Nat) :=
  [("zero", 0), ("low", 42), ("high", 42 * 2 ^ 64), ("both", 42 + 17 * 2 ^ 64),
    ("max", 2 ^ 128 - 1), ("alias", 2 ^ 64 + 2 ^ 17)]

def seeds : List (String × Nat) :=
  [("zero", 0), ("one", 1), ("pattern", 0x0123456789abcdef), ("max", 2 ^ 64 - 1)]

def traces : List (String × List Kind) :=
  [("commands", [.command, .command, .command]),
    ("events", [.event, .event, .event, .event]),
    ("roundrobin", [.command, .event, .invocation, .transaction, .correlation,
      .command, .event, .invocation, .transaction, .correlation]),
    ("reversed", [.correlation, .transaction, .invocation, .event, .command,
      .correlation, .transaction, .invocation, .event, .command]),
    ("weighted", [.invocation, .event, .event, .command, .transaction,
      .event, .correlation, .command, .transaction, .invocation, .invocation, .event]),
    ("empty", [])]

def answer (session seed : Nat) (choices : List Kind) : List Nat :=
  let lo := BitVec.ofNat 64 session
  let hi := BitVec.ofNat 64 (session / 2 ^ 64)
  let seed := BitVec.ofNat 64 seed
  (List.range choices.length).filterMap fun i =>
    choices[i]?.map (nextId lo hi seed (choices.take i))

def csv (values : List Nat) : String :=
  if values.isEmpty then "-" else String.intercalate "," (values.map toString)

/-- Each row records the factors, inputs, operation sequence, and exact returned IDs. -/
def traceRows : List String :=
  sessions.flatMap fun (sessionName, session) =>
    seeds.flatMap fun (seedName, seed) =>
      traces.map fun (traceName, trace) =>
        let operations := if trace.isEmpty then "-" else String.join (trace.map Kind.code)
        String.intercalate "\t"
          ["trace", sessionName, seedName, traceName, toString session, toString seed, operations,
            csv (answer session seed trace)]

def drawSeeds : List Nat := [0, 1, 7, 42, 99, 1234, 0x0123456789abcdef, 2 ^ 64 - 1]

def drawRows : List String := drawSeeds.map fun seed =>
  let words := (List.range 12).map fun i => (draw (BitVec.ofNat 64 seed) i).toNat
  s!"draw\t{seed}\t{csv words}"

def bounds : List Nat := [0, 1, 10, 2 ^ 63 + 1, 10, 2 ^ 32, 2 ^ 64 - 1, 1, 2, 16, 256]

/-- Finite input catches a runaway rejection sequence as an error. -/
def boundedDraws : List Nat → List Word → Except String (List Nat × Nat)
  | [], word :: _ => .ok ([], word.toNat)
  | [], [] => .error "no post-draw word"
  | bound :: rest, words => do
      let usable := if bound ≤ 1 then words
        else words.dropWhile (fun w => decide (rejectionZone bound ≤ w.toNat))
      let some got := selectBelow bound usable | .error "no acceptable word"
      let (later, after) ← boundedDraws rest (if bound ≤ 1 then usable else usable.drop 1)
      return (got :: later, after)

def belowRow (seed : Nat) : Except String String := do
  let stream := (List.range 128).map (draw (BitVec.ofNat 64 seed))
  let (values, after) ← boundedDraws bounds stream
  return s!"below\t{seed}\t{csv bounds}\t{csv values}\t{after}"

def main : IO Unit := do
  let below ← match drawSeeds.mapM belowRow with
    | .error error => throw (IO.userError error)
    | .ok rows => pure rows
  let rows := traceRows ++ drawRows ++ below
  IO.println s!"# {rows.length} cases"
  rows.forM IO.println
