import AdapterNoticeLimit

open AN

def render : Emitted → String
  | .silent => "-"
  | .first => "first"
  | .stop => "stop"

def main : IO Unit := do
  IO.println "# prior|phase|case|sequence|outcomes"
  for prior in [1, 31, 32] do
    for phase in ["start", "stopped"] do
      if phase == "start" || prior == 32 then
        for label in ["known", "new", "repeat", "distinct"] do
          let prefixNames := List.range prior
          let next := match label with
            | "known" => [0]
            | "new" => [50]
            | "repeat" => [50, 50]
            | _ => [50, 51]
          let trace := prefixNames ++ (if phase == "stopped" then [49] else []) ++ next
          let results := replay 32 {} trace
          let names := String.intercalate "," (trace.map (fun n => s!"r{n}"))
          let codes := String.intercalate "," (results.map render)
          IO.println s!"{prior}|{phase}|{label}|{names}|{codes}"
  for (label, trace) in [("first-ever", [50]), ("first-then-repeat", [50, 50])] do
    let names := String.intercalate "," (trace.map (fun n => s!"r{n}"))
    let codes := String.intercalate "," ((replay 32 {} trace).map render)
    IO.println s!"0|start|{label}|{names}|{codes}"
