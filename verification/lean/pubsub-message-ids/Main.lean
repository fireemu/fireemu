import PubSubMessageIds

open PMI

def sessions : List (String × Nat) :=
  [("zero", 0), ("low", 42), ("high", 42 * 2 ^ 64), ("both", 42 + 17 * 2 ^ 64),
    ("max", 2 ^ 128 - 1)]

def counters : List (String × Nat) :=
  [("zero", 0), ("first", 1), ("halfMinusOne", half - 1), ("half", half),
    ("halfPlusOne", half + 1), ("span", span), ("spanPlusOne", span + 1), ("max", 2 ^ 64 - 1)]

def counts : List (String × Nat) :=
  [("zero", 0), ("one", 1), ("half", half), ("max", 2 ^ 64 - 1)]

/-- Columns are factors, inputs, the three IDs, and the advanced runtime position. -/
def rows : List String :=
  sessions.flatMap fun (sessionName, session) =>
    counters.flatMap fun (counterName, counter) =>
      counts.map fun (countName, count) =>
        String.intercalate "\t"
          ([sessionName, counterName, countName] ++ [session, counter, count, brokerId counter,
            runtimeId counter, seededRuntimeId session counter, position counter count].map toString)

def main : IO Unit := do
  IO.println s!"# {rows.length} cases"
  rows.forM IO.println
