import RulesFailureAlgebra

open RulesFailureAlgebra

def operandLabel : Operand → String
  | .yes => "true"
  | .no => "false"
  | .missing => "missing"
  | .fault => "fault"
  | .unsupported => "unsupported"

def outcomeLabel : Outcome → String
  | .returned true => "allow"
  | .returned false | .deferred => "deny"
  | .refused => "unsupported"

def negate : Outcome → Outcome
  | .returned b => .returned !b
  | .deferred => .deferred
  | .refused => .refused

def main : IO Unit := do
  let values := [Operand.yes, .no, .missing, .fault, .unsupported]
  IO.println "# 250 cases"
  for stop in [false, true] do
    for first in values do
      for second in values do
        for third in values do
          let result := observe stop [first, second, third]
          let op := if stop then "or" else "and"
          IO.println (String.intercalate "\t" [op, operandLabel first, operandLabel second, operandLabel third,
            outcomeLabel result.outcome, outcomeLabel (negate result.outcome), toString result.readMissing])
