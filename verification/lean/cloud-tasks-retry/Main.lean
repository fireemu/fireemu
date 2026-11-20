import CloudTasksRetry

open CTRetry

def main : IO Unit := do
  IO.println "# exhaustion and backoff rows, pipe-delimited"
  for limit in limits do
    for (budgetLabel, budget) in budgets do
      for age in elapsed do
        for attempt in attempts do
          IO.println s!"exhausted|{limit}|{budgetLabel}|{age}|{attempt}|{exhausted limit attempt budget age}"
  for (label, minMillis, maxMillis, doublings) in backoffs do
    for attempt in attempts do
      for production in [false, true] do
        let declared := declaredGap minMillis maxMillis doublings attempt
        IO.println s!"backoff|{label}|{attempt}|{production}|{minMillis}|{maxMillis}|{doublings}|{declared}|{gapMillis production attempt declared}"
