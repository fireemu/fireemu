import EventRetry

open EventRetry

def policies : List (String × Policy) :=
  [("ordinary", ⟨3, 1_000_000_000, 5_000_000_000, none, none⟩),
   ("linear", ⟨2, 4_000_000_000, 60_000_000_000, some 1, some 22_000_000_000⟩),
   ("no-doubling", ⟨1, 2_000_000_000, 60_000_000_000, some 0, some 20_000_000_000⟩),
   ("zero-base", ⟨200, 0, 42, none, none⟩),
   ("wide", ⟨2, maxInt / 2 + 1, maxInt, none, none⟩),
   ("finite", ⟨1, 1, 2, some 1, some maxInt⟩),
   ("zero-attempts", ⟨0, 0, 0, none, none⟩),
   ("negative-base", ⟨1, -1, 0, none, none⟩),
   ("negative-cap", ⟨1, 0, -1, none, none⟩),
   ("inverted", ⟨1, 2, 1, none, none⟩),
   ("negative-window-first", ⟨0, 2, 1, some 1, some (-1)⟩),
   ("zero-first", ⟨0, -1, -2, some 1, some 0⟩)]

def attempts : List (String × Nat) :=
  [("zero", 0), ("first", 1), ("second", 2), ("third", 3), ("sixth", 6),
   ("before-cutoff", 120), ("cutoff", 121), ("large", 4294967295)]

def elapsedValues : List (String × Int) :=
  [("zero", 0), ("negative", -1), ("before", 11_999_999_999), ("exact", 12_000_000_000),
   ("past", 12_000_000_001), ("max", maxInt), ("min", minInt)]

def showOptional {α : Type} [ToString α] (value : Option α) : String :=
  value.map toString |>.getD "-"

def row (policy : String) (p : Policy) (step : String) (a : Nat) (age : String) (e : Int) : String :=
  let result := p.error.getD (String.intercalate "," [toString (p.backoff a),
    toString (p.byAttempts a), toString (p.byAge a e)])
  String.intercalate "\t" [policy, step, age, toString p.attempts, toString p.base, toString p.cap,
    showOptional p.doublings, showOptional p.window, toString a, toString e, result]

def main : IO Unit := do
  IO.println s!"# {policies.length * attempts.length * elapsedValues.length} cases."
  for (name, policy) in policies do
    for (step, a) in attempts do
      for (label, e) in elapsedValues do
        IO.println (row name policy step a label e)
