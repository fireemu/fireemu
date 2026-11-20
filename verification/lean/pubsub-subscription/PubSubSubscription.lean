import Std

namespace PubSubSubscription

def seconds (s : Int) : Int := s * 1000000000

def between (low high x : Int) : Bool := low ≤ x && x ≤ high

inductive Issue where
  | coreAck | retention | deadLow | deadHigh | retryMin | retryMax | retryOrder
  | productionAck | labels | expiryMinimum | retentionAfterExpiry
  deriving Repr, DecidableEq

def Issue.label : Issue → String
  | .coreAck => "coreAck"
  | .retention => "retention"
  | .deadLow => "deadLow"
  | .deadHigh => "deadHigh"
  | .retryMin => "retryMin"
  | .retryMax => "retryMax"
  | .retryOrder => "retryOrder"
  | .productionAck => "productionAck"
  | .labels => "labels"
  | .expiryMinimum => "expiryMinimum"
  | .retentionAfterExpiry => "retentionAfterExpiry"

inductive Expiry where
  | serviceDefault
  | disabled
  | explicit (nanos : Int)
  deriving Repr, DecidableEq

def Expiry.resolve : Expiry → Option Int
  | .serviceDefault => some (seconds 2678400)
  | .disabled => none
  | .explicit nanos => some nanos

def effectiveRetention (retention : Option Int) : Int :=
  retention.getD (seconds 604800)

def retryIssue (minimum maximum : Int) : Option Issue :=
  if !between 0 (seconds 600) minimum then some .retryMin
  else if !between 0 (seconds 600) maximum then some .retryMax
  else if minimum > maximum then some .retryOrder
  else none

def deadIssue (attempts : Nat) : Option Issue :=
  if attempts < 5 then some .deadLow
  else if 100 < attempts then some .deadHigh
  else none

def coreIssue (ack : Nat) (retention : Option Int) (attempts : Option Nat)
    (retry : Option (Int × Int)) : Option Issue :=
  if ack < 1 ∨ 600 < ack then some .coreAck
  else if retention.any (!between (seconds 600) (seconds 2678400) ·) then some .retention
  else (attempts.bind deadIssue).orElse fun _ =>
    retry.bind fun (minimum, maximum) => retryIssue minimum maximum

def productionIssue (ack : Nat) (retention : Option Int) (expiry : Expiry)
    (labelsValid : Bool) : Option Issue :=
  if ack < 10 ∨ 600 < ack then some .productionAck
  else if !labelsValid then some .labels
  else expiry.resolve.bind fun ttl =>
    if ttl < seconds 86400 then some .expiryMinimum
    else if ttl < effectiveRetention retention then some .retentionAfterExpiry
    else none

theorem core_rejects_ack_first (ack : Nat) (ret : Option Int) (attempts : Option Nat)
    (retry : Option (Int × Int)) (bad : ack < 1 ∨ 600 < ack) :
    coreIssue ack ret attempts retry = some .coreAck := by
  unfold coreIssue
  rw [ite_eq_left bad]

theorem retry_accepted_iff (minimum maximum : Int) :
    retryIssue minimum maximum = none ↔
      (0 ≤ minimum ∧ minimum ≤ seconds 600) ∧
      (0 ≤ maximum ∧ maximum ≤ seconds 600) ∧ minimum ≤ maximum := by
  simp [retryIssue, between]
  split
  · simp
    omega
  · split
    · simp
      omega
    · split <;> simp <;> omega

theorem production_refuses_bad_labels_first (ack : Nat) (ret : Option Int) (expiry : Expiry)
    (validAck : ¬ (ack < 10 ∨ 600 < ack)) :
    productionIssue ack ret expiry false = some .labels := by
  simp [productionIssue, validAck]

theorem disabled_expiry_ignores_retention (ack : Nat) (retention : Option Int)
    (validAck : ¬ (ack < 10 ∨ 600 < ack)) :
    productionIssue ack retention .disabled true = none := by
  simp [productionIssue, Expiry.resolve, validAck]

theorem successful_explicit_expiry_covers_retention
    (ack : Nat) (retention : Option Int) (ttl : Int)
    (accepted : productionIssue ack retention (.explicit ttl) true = none) :
    seconds 86400 ≤ ttl ∧ effectiveRetention retention ≤ ttl := by
  unfold productionIssue at accepted
  split at accepted
  · contradiction
  · simp only [Bool.not_true, Bool.false_eq_true, ite_false, Expiry.resolve, Option.bind_some] at accepted
    split at accepted
    · contradiction
    · split at accepted
      · contradiction
      · omega

theorem omitted_retention_is_one_week :
    effectiveRetention none = seconds 604800 := rfl

end PubSubSubscription

/- Axiom guards for the stated contract laws. -/

/-- info: 'PubSubSubscription.core_rejects_ack_first' does not depend on any axioms -/
#guard_msgs in #print axioms PubSubSubscription.core_rejects_ack_first

/-- info: 'PubSubSubscription.retry_accepted_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubSubscription.retry_accepted_iff

/-- info: 'PubSubSubscription.production_refuses_bad_labels_first' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubSubscription.production_refuses_bad_labels_first

/-- info: 'PubSubSubscription.disabled_expiry_ignores_retention' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubSubscription.disabled_expiry_ignores_retention

/-- info: 'PubSubSubscription.successful_explicit_expiry_covers_retention' depends on axioms: [propext,
 Classical.choice,
 Quot.sound] -/
#guard_msgs in #print axioms PubSubSubscription.successful_explicit_expiry_covers_retention

/-- info: 'PubSubSubscription.omitted_retention_is_one_week' does not depend on any axioms -/
#guard_msgs in #print axioms PubSubSubscription.omitted_retention_is_one_week
