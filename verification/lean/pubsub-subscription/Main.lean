import PubSubSubscription

open PubSubSubscription

def ackCases : List (String × Nat) :=
  [("zero", 0), ("core-min", 1), ("below-strict", 9), ("min", 10), ("max", 600), ("over", 601)]

def retentionCases : List (String × Option Int) :=
  [("omitted", none), ("zero", some 0), ("below", some (seconds 600 - 1)),
   ("min", some (seconds 600)), ("week", some (seconds 604800)),
   ("max", some (seconds 2678400)), ("over", some (seconds 2678400 + 1))]

def deadCases : List (String × Option Nat) :=
  [("omitted", none), ("below", some 4), ("min", some 5), ("max", some 100), ("over", some 101)]

def retryCases : List (String × Option (Int × Int)) :=
  [("omitted", none), ("zero", some (0, 0)), ("max", some (seconds 600, seconds 600)),
   ("min-negative", some (-1, 0)), ("min-over", some (seconds 600 + 1, seconds 600)),
   ("max-negative", some (0, -1)), ("max-over", some (0, seconds 600 + 1)),
   ("reversed", some (seconds 20, seconds 20 - 1)), ("fractional", some (1, seconds 10 + 1))]

def expiryCases : List (String × Expiry) :=
  [("default", .serviceDefault), ("never", .disabled),
   ("below", .explicit (seconds 86400 - 1)), ("day", .explicit (seconds 86400)),
   ("week-below", .explicit (seconds 604800 - 1)), ("week", .explicit (seconds 604800)),
   ("long", .explicit (seconds 2678400 + 1))]

def expiryWire : Expiry → String
  | .serviceDefault => "default"
  | .disabled => "never"
  | .explicit nanos => toString nanos

def issueName (issue : Option Issue) : String := (issue.map Issue.label).getD "ok"

def showOpt [ToString α] (v : Option α) : String := (v.map toString).getD "-"

def main : IO Unit := do
  let count := ackCases.length * retentionCases.length *
    (deadCases.length * retryCases.length + expiryCases.length * 2)
  IO.println s!"# {count}"
  for (al, ack) in ackCases do
    for (rl, retention) in retentionCases do
      for (dl, dead) in deadCases do
        for (bl, retry) in retryCases do
          IO.println (String.intercalate "\t"
            ["core", al, rl, dl, bl, toString ack, showOpt retention, showOpt dead,
             showOpt (retry.map Prod.fst), showOpt (retry.map Prod.snd),
             issueName (coreIssue ack retention dead retry)])
      for (el, expiry) in expiryCases do
        for labelsValid in [true, false] do
          IO.println (String.intercalate "\t"
            ["production", al, rl, el, if labelsValid then "valid" else "invalid",
             toString ack, showOpt retention, expiryWire expiry,
             issueName (productionIssue ack retention expiry labelsValid),
             toString (effectiveRetention retention)])
