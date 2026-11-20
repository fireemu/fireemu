import Std

namespace EventOutbox

inductive Phase where
  | pending | leased | running | waiting (due : Nat) | terminal
  deriving DecidableEq, Repr

structure Entry where
  id : Nat
  time : Nat
  queue : String
  phase : Phase := .pending
  deriving DecidableEq, Repr

structure State where
  retention : Nat
  entries : List Entry := []
  retired : List Nat := []
  evictions : Nat := 0
  deriving DecidableEq, Repr

def State.lookup (s : State) (id : Nat) : Option Entry :=
  s.entries.find? (·.id == id)

def keyLE (a b : Nat × Nat) : Bool :=
  decide (a.1 < b.1 ∨ a.1 = b.1 ∧ a.2 ≤ b.2)

def keyLT (a b : Nat × Nat) : Bool :=
  decide (a.1 < b.1 ∨ a.1 = b.1 ∧ a.2 < b.2)

def Entry.key (e : Entry) : Nat × Nat := (e.time, e.id)

/-- The sorted view is recomputed from retained entries. There are no redundant indexes. -/
def State.pending (s : State) : List Entry :=
  (s.entries.filter (·.phase == .pending)).mergeSort (fun a b => keyLE a.key b.key)

def State.queue (s : State) (queue : String) : List Entry :=
  s.pending.filter (·.queue == queue)

def State.successor (s : State) (queue : String) (after : Nat × Nat) : Option Entry :=
  (s.queue queue).find? (fun e => keyLT after e.key)

def State.due (s : State) (now : Nat) : List Nat :=
  let keys := s.entries.filterMap fun e =>
    match e.phase with
    | .waiting next => if next ≤ now then some (next, e.id) else none
    | _ => none
  (keys.mergeSort keyLE).map Prod.snd

def State.active (s : State) : Bool := s.entries.any (·.phase != .terminal)

def retainedTerminal (retention : Nat) (ids : List Nat) : List Nat :=
  ids.drop (ids.length - max 1 retention)

def State.replace (s : State) (entry : Entry) : State :=
  { s with entries := s.entries.map fun old => if old.id = entry.id then entry else old }

def State.retire (s : State) (entry : Entry) : State :=
  let marked := s.replace { entry with phase := .terminal }
  let order := s.retired ++ [entry.id]
  let kept := retainedTerminal s.retention order
  let removed := order.take (order.length - kept.length)
  { marked with
    retired := kept
    entries := marked.entries.filter (fun r => !removed.contains r.id)
    evictions := s.evictions + removed.length }

inductive Operation where
  | enqueue (entry : Entry)
  | lease (id : Nat) | run (id : Nat) | wait (id now : Nat)
  | release (id now : Nat) | interrupt (id : Nat) | retire (id : Nat)
  deriving DecidableEq, Repr

def Operation.id : Operation → Nat
  | .enqueue e => e.id
  | .lease id | .run id | .wait id _ | .release id _ | .interrupt id | .retire id => id

/-- The closure's result is separate from Outbox's record lookup. The wait operation
uses a one-tick backoff and a budget larger than every replayed trace. -/
def step (s : State) (op : Operation) : State × String :=
  match op with
  | .enqueue e =>
    if (s.lookup e.id).isSome then (s, "duplicate")
    else ({ s with entries := e :: s.entries }, "ok")
  | _ =>
    match s.lookup op.id with
    | none => (s, "unknown")
    | some e =>
      let move (phase : Phase) := (s.replace { e with phase := phase }, "ok")
      if e.phase = .terminal then (s, "terminal")
      else match op, e.phase with
      | .lease _, .pending => move .leased
      | .run _, .leased => move .running
      | .wait _ now, .running => move (.waiting (now + 1))
      | .release _ now, .waiting due => if due ≤ now then move .pending else (s, "not-due")
      | .interrupt _, .running => move .pending
      | .retire _, _ => (s.retire e, "ok")
      | _, _ => (s, "invalid")

end EventOutbox
