import Std

namespace PubSubAckLease

inductive Clock where
  | logical | delivery
  deriving DecidableEq, Repr

inductive Backoff where
  | immediate | bounded | pushMin
  deriving DecidableEq, Repr

structure Now where
  logical : Int
  delivery : Int
  deriving DecidableEq, Repr

def Now.at (now : Now) : Clock → Int
  | .logical => now.logical
  | .delivery => max now.logical now.delivery

structure Stamp where
  clock : Clock
  atTime : Int
  deriving DecidableEq, Repr

def Stamp.due (stamp : Stamp) (now : Now) : Bool :=
  decide (stamp.atTime ≤ now.at stamp.clock)

structure Config where
  clock : Clock
  backoff : Backoff
  budget : Option Nat

inductive Status where
  | available (ready : Stamp)
  | outstanding (id : Nat) (deadline : Stamp)
  | forwardPending
  | acked
  deriving DecidableEq, Repr

structure Broker where
  status : Status
  attempt : Nat
  issued : Nat
  deriving DecidableEq, Repr

def initial : Broker := ⟨.available ⟨.logical, 0⟩, 0, 0⟩

def delay (config : Config) (attempt : Nat) : Nat :=
  match config.backoff with
  | .immediate => 0
  | .bounded => min 8 (2 * 2 ^ min 127 (attempt - 1))
  | .pushMin => if config.clock = .logical then 3 else 0

def stamp (config : Config) (now : Now) (after : Nat) : Stamp :=
  ⟨config.clock, now.at config.clock + after⟩

def release (config : Config) (now : Now) (broker : Broker) : Broker :=
  { broker with status := .available (stamp config now (delay config broker.attempt)) }

def expire (config : Config) (now : Now) (broker : Broker) : Broker :=
  match broker.status with
  | .outstanding _ deadline => if deadline.due now then release config now broker else broker
  | _ => broker

inductive Pull where
  | nothing
  | received (id attempt : Nat)
  | forward
  deriving DecidableEq, Repr

def pull (config : Config) (now : Now) (limit : Nat) (broker : Broker) : Pull × Broker :=
  match broker.status with
  | .available ready =>
    if limit > 0 && ready.due now then
      if config.budget.any (· ≤ broker.attempt) then
        (.forward, { broker with status := .forwardPending })
      else
        let id := broker.issued + 1
        let attempt := broker.attempt + 1
        (.received id attempt, ⟨.outstanding id (stamp config now 10), attempt, id⟩)
    else (.nothing, broker)
  | _ => (.nothing, broker)

def acknowledge (id : Nat) (broker : Broker) : Nat × Broker :=
  match broker.status with
  | .outstanding liveId _ =>
      if liveId = id then (1, { broker with status := .acked }) else (0, broker)
  | _ => (0, broker)

def modify (config : Config) (now : Now) (id seconds : Nat) (broker : Broker) : Broker :=
  match broker.status with
  | .outstanding liveId _ =>
    if id = liveId then
      if seconds = 0 then release config now broker
      else { broker with status := .outstanding liveId (stamp config now seconds) }
    else broker
  | _ => broker

def complete (id : String) (broker : Broker) : Bool × Broker :=
  if id = "message" ∧ broker.status = .forwardPending then
    (true, { broker with status := .acked })
  else (false, broker)

theorem stale_ack_leaves_live_lease (broker : Broker) (liveId staleId : Nat) (deadline : Stamp)
    (leased : broker.status = .outstanding liveId deadline) (stale : liveId ≠ staleId) :
    acknowledge staleId broker = (0, broker) := by simp [acknowledge, leased, stale]

theorem nack_preserves_attempt (config : Config) (now : Now) (id : Nat) (broker : Broker) :
    (modify config now id 0 broker).attempt = broker.attempt := by
  cases h : broker.status <;> simp [modify, h]
  split <;> simp [release]

theorem deadline_is_due_at_equality (now : Now) (clock : Clock) :
    (⟨clock, now.at clock⟩ : Stamp).due now = true := by simp [Stamp.due]

theorem retry_never_greater_than_eight (config : Config) (attempt : Nat) :
    delay config attempt ≤ 8 := by
  cases h : config.backoff <;> simp [delay, h]
  · exact Nat.min_le_left _ _
  · split <;> decide

theorem forwarding_does_not_issue_ack (config : Config) (now : Now) (limit : Nat) (broker next : Broker)
    (forwarded : pull config now limit broker = (.forward, next)) :
    next.issued = broker.issued ∧ next.attempt = broker.attempt := by
  unfold pull at forwarded
  split at forwarded
  · split at forwarded
    · split at forwarded
      · cases forwarded
        exact ⟨rfl, rfl⟩
      · simp at forwarded
    · simp at forwarded
  · simp at forwarded

end PubSubAckLease

/- Guard the axioms used by the stated laws. -/

/-- info: 'PubSubAckLease.stale_ack_leaves_live_lease' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubAckLease.stale_ack_leaves_live_lease

/-- info: 'PubSubAckLease.nack_preserves_attempt' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubAckLease.nack_preserves_attempt

/-- info: 'PubSubAckLease.deadline_is_due_at_equality' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubAckLease.deadline_is_due_at_equality

/-- info: 'PubSubAckLease.retry_never_greater_than_eight' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubAckLease.retry_never_greater_than_eight

/-- info: 'PubSubAckLease.forwarding_does_not_issue_ack' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubAckLease.forwarding_does_not_issue_ack
