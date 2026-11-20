import CloudTasksAdmission

open CTAdmission

def main : IO Unit := do
  IO.println "# unknown|syntax|scenario|outcome|size_called|schedule_ns|deadline_seconds|view"
  for unknown in [Unknown.none, .request, .task, .http] do
    for syntaxState in [Syntax.valid, .schedule, .deadline, .both] do
      for (label, fields) in scenarios do
        let (sizeCalled, answer) := admit unknown syntaxState fields now 17
        match answer with
        | .error reason => IO.println s!"{unknown.label}|{syntaxState.label}|{label}|{reason}|{sizeCalled}|-|-|-"
        | .ok a =>
          let view := if a.full then "FULL" else "BASIC"
          IO.println s!"{unknown.label}|{syntaxState.label}|{label}|accepted|{sizeCalled}|{a.schedule}|{a.deadlineSeconds}|{view}"
