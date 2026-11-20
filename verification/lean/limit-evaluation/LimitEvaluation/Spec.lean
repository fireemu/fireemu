import Std

namespace LimitEvaluation

inductive Boundary where
  | inclusive | exclusive | exact | range | syntax | truncating
  deriving Repr, DecidableEq

def Boundary.name : Boundary → String
  | .inclusive => "inclusive"
  | .exclusive => "exclusive"
  | .exact => "exact"
  | .range => "range"
  | .syntax => "syntax"
  | .truncating => "truncating"

inductive Maximum where
  | missing
  | fixed (value : Nat)
  | billable (withoutBilling withBilling : Nat)

structure Profile where
  maximum : Maximum
  billing : Bool := false
  overrideApplies : Bool := false
  supportOverride : Option Nat := none

def Profile.effective (p : Profile) : Option Nat :=
  if let some limit := if p.overrideApplies then p.supportOverride else none then
    some limit
  else match p.maximum with
    | .missing => none
    | .fixed n => some n
    | .billable without withBilling => some (if p.billing then withBilling else without)

def violates (b : Boundary) (current maximum : Nat) : Bool :=
  match b with
  | .inclusive | .range | .syntax => current > maximum
  | .exclusive => current ≥ maximum
  | .exact => current ≠ maximum
  | .truncating => false

def reaches (current maximum basisPoints : Nat) : Bool :=
  if maximum = 0 then current > 0 else current * 10_000 ≥ maximum * basisPoints

def maxMicros : Nat := 2 ^ 32 - 1

def ratioMicros (current maximum : Nat) : Nat :=
  if maximum = 0 then if current = 0 then 0 else maxMicros
  else min maxMicros (current * 1_000_000 / maximum)

inductive Severity where
  | notice | warning | critical
  deriving Repr, DecidableEq

def Severity.name : Severity → String
  | .notice => "notice"
  | .warning => "warning"
  | .critical => "critical"

/-- The default policy has ascending thresholds and returns the highest severity reached. -/
def severity (current maximum : Nat) : Option Severity :=
  if reaches current maximum 9_500 then some .critical
  else if reaches current maximum 8_500 then some .warning
  else if reaches current maximum 7_500 then some .notice
  else none

inductive Disposition where
  | allow
  | warning (severity : Severity) (ratio : Nat)
  | reject
  | observe
  deriving Repr, DecidableEq

def evaluate (boundary : Boundary) (observe : Bool) (maximum : Option Nat)
    (current : Nat) : Disposition :=
  match maximum with
  | none => .allow
  | some max =>
    if violates boundary current max then
      if observe then .observe else .reject
    else match severity current max with
      | none => .allow
      | some s => .warning s (ratioMicros current max)

end LimitEvaluation
