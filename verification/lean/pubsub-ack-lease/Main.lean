import PubSubAckLease

open PubSubAckLease

inductive Op where
  | pull (when : Now) (limit : Nat)
  | expire (when : Now)
  | modify (when : Now) (id seconds : Nat)
  | ack (id : Nat)
  | complete (message : String)

def traces (gap : Int) : List (String × List Op) :=
  let t := fun n => (⟨n, n + gap⟩ : Now)
  let start := (⟨0, 0⟩ : Now)
  let fwd : List Op := (List.range 5).flatMap fun n =>
    let atTime := t ((Int.ofNat n) * 20)
    [.pull atTime 1, .modify atTime (n + 1) 0]
  [("expiry", [.pull start 0, .pull start 1, .pull (t 9) 1, .expire (t 9),
      .pull (t 10) 1, .expire (t 10), .pull (t 10) 1, .ack 1,
      .pull (t 20) 1, .ack 1, .ack 2, .pull (t 20) 1]),
   ("nack", [.pull start 1, .modify (t 1) 1 0, .ack 1, .pull (t 1) 1,
      .pull (t 2) 1, .pull (t 3) 1, .expire (t 13), .pull (t 30) 1,
      .ack 2, .ack 3]),
   ("extend", [.pull start 1, .modify (t 2) 0 30, .modify (t 2) 1 20,
      .expire (t 10), .pull (t 10) 1, .expire (t 21), .expire (t 22),
      .ack 1, .pull (t 30) 1, .ack 2]),
   ("forward", fwd ++ [.pull (t 100) 1, .ack 5, .complete "unknown",
      .complete "message", .complete "message", .pull (t 120) 1])]

def emit (fields : List String) := IO.println (String.intercalate "\t" fields)

def renderPull : Pull → String
  | .nothing => "-"
  | .received id attempt => s!"pull:{id}:{attempt}"
  | .forward => "forward"

def clockLabel : Clock → String
  | .logical => "push"
  | .delivery => "pull"

def backoffLabel : Backoff → String
  | .immediate => "immediate"
  | .bounded => "bounded"
  | .pushMin => "push-min"

def row (op : String) (when : Now) (first second result : String) : List String :=
  [op, toString when.logical, toString when.delivery, first, second, result]

def observations (broker : Broker) : List String :=
  match broker.status with
  | .available stamp => [toString stamp.atTime, "0", "0", "1"]
  | .outstanding .. => ["-", "1", "0", "1"]
  | .forwardPending => ["-", "0", "1", "1"]
  | .acked => ["-", "0", "0", "0"]

def apply (config : Config) (broker : Broker) : Op → List String × Broker
  | .pull when limit =>
    let (output, next) := pull config when limit broker
    (row "pull" when (toString limit) "-" (renderPull output), next)
  | .expire when =>
    (row "expire" when "-" "-" "-", expire config when broker)
  | .modify when id seconds =>
    (row "modify" when (toString id) (toString seconds) "-", modify config when id seconds broker)
  | .ack id =>
    let (count, next) := acknowledge id broker
    (row "ack" ⟨0, 0⟩ (toString id) "-" s!"ack:{count}", next)
  | .complete message =>
    let (done, next) := complete message broker
    (row "complete" ⟨0, 0⟩ message "-" s!"complete:{done}", next)

def main : IO Unit := do
  let clocks := [Clock.logical, Clock.delivery]
  let backoffs := [Backoff.immediate, Backoff.bounded, Backoff.pushMin]
  let gaps : List (String × Int) := [("aligned", 0), ("skewed", 7)]
  let count := (traces 0).foldl (fun n (_, ops) => n + 1 + ops.length) 0
  IO.println s!"# {clocks.length * backoffs.length * gaps.length * count}"
  for clock in clocks do
    for backoff in backoffs do
      for (gapLabel, gap) in gaps do
        for (family, ops) in traces gap do
          emit ["trace", clockLabel clock, backoffLabel backoff, gapLabel, family]
          let config : Config := ⟨clock, backoff, if family == "forward" then some 5 else none⟩
          let mut broker := initial
          for op in ops do
            let (fields, next) := apply config broker op
            broker := next
            emit (fields ++ observations broker)
