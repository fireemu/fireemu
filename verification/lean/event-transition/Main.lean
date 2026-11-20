import EventTransition

open EventTransition

/-- Public-API preambles can reach each of these records; see the Rust replay. -/
def sources : List (String × Record) :=
  ([⟨.pending, 0, 0⟩, ⟨.leased, 0, 0⟩, ⟨.running, 1, 0⟩, ⟨.succeeded, 1, 0⟩,
     ⟨.waiting, 1, 11⟩, ⟨.dead, 1, 0⟩, ⟨.cancelled, 0, 0⟩, ⟨.stale, 0, 0⟩] : List Record)
    |>.map (fun s => (s.phase.name, s))
    |>.append [("retry-leased", leasedRetry), ("retry-running", runningRetry)]

def actions : List Action := [.lease, .start, .succeed, .fail, .interrupt, .retry, .cancel, .discard]

def probes : List (String × Probe) :=
  [("default", ⟨10, false, 2, none⟩),
   ("before", ⟨-1, false, 1, some 0⟩),
   ("exact", ⟨11, false, 1, some 12⟩),
   ("after", ⟨12, true, 1, some 12⟩),
   ("overflow", ⟨maxInstant, true, 2, none⟩),
   ("exhausted", ⟨10, false, 1, none⟩)]

def row (source : String) (s : Record) (a : Action) (label : String) (probe : Probe) : String :=
  let (next, result) := match step s a probe with
    | .ok value => value
    | .error problem => (s, problem)
  let payload := match next.phase with
    | .waiting => toString next.retryAt
    | .dead => toString next.attempt
    | _ => "-"
  String.intercalate "\t" [source, a.name, label,
    toString probe.now, toString probe.newerEpoch, toString probe.attemptLimit,
    probe.maxAge.map toString |>.getD "-", result, next.phase.name, toString next.attempt, payload]

def main : IO Unit := do
  IO.println s!"# {sources.length * actions.length * probes.length} cases."
  for (name, s) in sources do
    for a in actions do
      for (label, probe) in probes do
        IO.println (row name s a label probe)
