import CloudTasksQueue

open CTQ

def main : IO Unit := do
  IO.println "# reuse|disposal|age|schedule|time:action:result:name:active:outstanding;..."
  for (reuseLabel, reuse) in reuseCases do
    for disposal in [Op.finish, .delete, .reset, .close] do
      for age in [0, 1, 2, 3] do
        for (scheduleLabel, schedule) in scheduleCases do
          let events := String.intercalate ";" (trace reuse schedule (timeline disposal schedule age) {})
          IO.println s!"{reuseLabel}|{disposal.label}|{age}|{scheduleLabel}|{events}"
