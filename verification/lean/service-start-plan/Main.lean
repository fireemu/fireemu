import ServiceStartPlan

open ServiceStartPlan

def choices : List (String × Option (List Service)) :=
  [("default", none), ("firestore", some [.firestore]), ("functions", some [.functions]),
   ("with-support", some [.firestore, .eventarc, .tasks]), ("support-only", some [.eventarc, .tasks]),
   ("optional", some [.pubsub, .database]), ("hosting", some [.hosting]), ("all", some services)]

def flags : List (String × Bool) := [("absent", false), ("present", true)]

def combinations : List (String × Bool × Bool) :=
  [("none", false, false), ("pubsub", true, false), ("database", false, true), ("both", true, true)]

def result : Except Refusal (List Service) → String
  | .error .hosting => "error-hosting"
  | .error .support => "error-support"
  | .ok started => "ok:" ++ String.intercalate "," (started.map serviceName)

def main : IO Unit := do
  let rows := choices.flatMap fun (selection, only) =>
    flags.flatMap fun (functionName, functions) =>
      flags.flatMap fun (hostingName, hosting) =>
        combinations.map fun (optional, pubsub, database) =>
          String.intercalate "\t"
            [s!"{selection}/{functionName}/{hostingName}/{optional}",
             (only.map fun selected => String.intercalate "," (List.map serviceName selected)).getD "-",
             functionName, hostingName, optional, result (plan only ⟨functions, hosting, pubsub, database⟩)]
  IO.println s!"# {rows.length} cases."
  for row in rows do IO.println row
