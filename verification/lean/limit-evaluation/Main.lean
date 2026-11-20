import LimitEvaluation

open LimitEvaluation

def profiles : List (String × Profile) :=
  [("fixed", ⟨.fixed 10_000, false, false, none⟩),
   ("none", ⟨.missing, false, false, none⟩),
   ("zero", ⟨.fixed 0, false, false, none⟩),
   ("wide", ⟨.fixed (2 ^ 64 - 1), false, false, none⟩),
   ("billing-off", ⟨.billable 20_000 40_000, false, true, none⟩),
   ("billing-on", ⟨.billable 20_000 40_000, true, true, none⟩),
   ("override", ⟨.billable 20_000 40_000, true, true, some 30_000⟩),
   ("unrelated", ⟨.billable 20_000 40_000, true, false, some 30_000⟩)]

def boundaries : List Boundary := [.inclusive, .exclusive, .exact, .range, .syntax, .truncating]

def stages : List (String × Bool) := [("request", false), ("observe", true)]

def amounts (max : Nat) : List (String × Nat) :=
  let bound := 2 ^ 64 - 1
  let threshold (bp : Nat) := (max * bp + 9_999) / 10_000
  [("zero", 0), ("pre-notice", threshold 7_500 - 1), ("notice", threshold 7_500),
   ("pre-warning", threshold 8_500 - 1), ("warning", threshold 8_500),
   ("pre-critical", threshold 9_500 - 1), ("critical", threshold 9_500),
   ("at", max), ("over", min bound (max + 1)), ("huge", bound)]

def row (b : Boundary) (profile : String) (p : Profile) (stage : String) (obs : Bool)
    (probe : String) (c : Nat) : String :=
  let maximum := p.effective
  let numeric := maximum.getD 0
  let verdict := match evaluate b obs maximum c with
    | .allow => "allow"
    | .warning s _ => s.name
    | .reject => "reject"
    | .observe => "observed"
  String.intercalate "\t" [b.name, profile, stage, probe, toString c,
    maximum.map toString |>.getD "-", toString (reaches c numeric 0),
    toString (reaches c numeric 7_500), toString (reaches c numeric 65_535),
    toString (ratioMicros c numeric), verdict]

def main : IO Unit := do
  IO.println s!"# {boundaries.length * profiles.length * stages.length * (amounts 0).length} cases."
  for b in boundaries do
    for (pname, p) in profiles do
      for (sname, stage) in stages do
        for (probe, current) in amounts (p.effective.getD 10_000) do
          IO.println (row b pname p sname stage probe current)
