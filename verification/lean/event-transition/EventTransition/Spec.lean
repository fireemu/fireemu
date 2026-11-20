import Std

namespace EventTransition

inductive Phase where
  | pending | leased | running | succeeded | waiting | dead | cancelled | stale
  deriving DecidableEq, Repr

def Phase.terminal : Phase → Bool
  | .succeeded | .dead | .cancelled | .stale => true
  | _ => false

def Phase.name : Phase → String
  | .pending => "pending"
  | .leased => "leased"
  | .running => "running"
  | .succeeded => "succeeded"
  | .waiting => "waiting"
  | .dead => "dead"
  | .cancelled => "cancelled"
  | .stale => "stale"

inductive Action where
  | lease | start | succeed | fail | interrupt | retry | cancel | discard
  deriving DecidableEq, Repr

def Action.name : Action → String
  | .lease => "lease"
  | .start => "start"
  | .succeed => "succeed"
  | .fail => "fail"
  | .interrupt => "interrupt"
  | .retry => "retry"
  | .cancel => "cancel"
  | .discard => "discard"

structure Record where
  phase : Phase := .pending
  attempt : Nat := 0
  retryAt : Int := 0
  deriving DecidableEq, Repr

structure Probe where
  now : Int
  newerEpoch : Bool
  attemptLimit : Nat
  maxAge : Option Int

def maxInstant : Int := 2 ^ 127 - 1
def maxAttempt : Nat := 2 ^ 32 - 1

/-- The event was produced at time zero and an individual backoff is one nanosecond.
The other policy coefficients belong to the separate event-retry model. -/
def Probe.retryAllowed (probe : Probe) (a : Nat) : Bool :=
  a < probe.attemptLimit || probe.maxAge.any (fun age =>
    decide (max 0 probe.now + 1 ≤ maxInstant ∧ max 0 probe.now + 1 ≤ age))

def Action.requires : Action → Option Phase
  | .lease => some .pending
  | .start => some .leased
  | .interrupt | .succeed | .fail => some .running
  | .retry => some .waiting
  | .cancel | .discard => none

def step (s : Record) (a : Action) (p : Probe) : Except String (Record × String) :=
  if s.phase.terminal then .error "terminal"
  else if a.requires.any (· != s.phase) then .error "invalid"
  else match a with
    | .lease => .ok ({ s with phase := .leased }, "ok")
    | .start =>
      if s.attempt ≥ maxAttempt then .error "attempt-overflow"
      else .ok ({ s with phase := .running, attempt := s.attempt + 1 }, "ok")
    | .succeed => .ok ({ s with phase := .succeeded }, "ok")
    | .interrupt => .ok ({ s with phase := .pending, attempt := s.attempt - 1 }, "ok")
    | .fail =>
      if !p.retryAllowed s.attempt then .ok ({ s with phase := .dead }, "dead-lettered")
      else if p.now + 1 > maxInstant then .error "instant-overflow"
      else .ok ({ s with phase := .waiting, retryAt := p.now + 1 }, "scheduled")
    | .retry =>
      if p.now < s.retryAt then .error "not-due"
      else .ok ({ s with phase := .pending }, "ok")
    | .cancel => .ok ({ s with phase := .cancelled }, "ok")
    | .discard =>
      if !p.newerEpoch then .error "epoch-current"
      else .ok ({ s with phase := .stale }, "ok")

def after (s : Record) (a : Action) (p : Probe) : Record :=
  ((step s a p).toOption.map Prod.fst).getD s

/-- The public phases reached by failing a first attempt and leasing its due retry. -/
def leasedRetry : Record :=
  let first : Probe := ⟨10, false, 2, none⟩
  let ready := { first with now := 11 }
  let leased := after {} .lease first
  let running := after leased .start first
  let waiting := after running .fail first
  after (after waiting .retry ready) .lease ready

def runningRetry : Record :=
  after leasedRetry .start ⟨11, false, 2, none⟩

end EventTransition
