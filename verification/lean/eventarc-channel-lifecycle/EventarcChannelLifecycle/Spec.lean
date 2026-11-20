import Std

namespace ECL

inductive Action where
  | observe | create | declare | delete
  deriving DecidableEq

inductive Status where
  | observed | created | declared | exists | deleted | missing
  deriving DecidableEq

inductive Phase where
  | absent | creating | ready | deleting
  deriving DecidableEq

structure Record where
  uid : Nat
  createdAt : Nat
  readyAt : Nat
  updatedAt : Nat
  retiring : Option (Nat × Nat)
  deriving DecidableEq

structure State where
  clock : Nat := 0
  assigned : Nat := 0
  channel : Option Record := none
  operationEnds : List Nat := []
  deriving DecidableEq

/-- Delays fixed by the replay's injected Timing. Time is in whole milliseconds. -/
def createDelay : Nat := 4
def deleteDelay : Nat := 3

def settle (s : State) (wall : Nat) : State :=
  let clock := max wall s.clock
  let channel := s.channel.filter (fun record => !(record.retiring.any (fun time => time.2 ≤ clock)))
  {s with clock, channel}

def phase (s : State) : Phase :=
  match s.channel with
  | none => .absent
  | some r =>
    if s.clock < r.readyAt then .creating
    else if r.retiring.isSome then .deleting else .ready

def metadata (s : State) : Option (Nat × Nat × Nat) :=
  s.channel.map (fun r =>
    let update := match phase s with
      | .creating => r.createdAt
      | .deleting => (r.retiring.map ((· + 2) ∘ Prod.fst)).getD r.updatedAt
      | _ => r.updatedAt
    (r.uid, r.createdAt, update))

def create (s : State) (declared : Bool) : Status × State :=
  if s.channel.isSome then (if declared then .declared else .exists, s)
  else
    let uid := s.assigned + 1
    let record := if declared then ⟨uid, s.clock, s.clock, s.clock, none⟩
      else ⟨uid, s.clock - 6, s.clock + createDelay, s.clock + createDelay + 20, none⟩
    let ends := if declared then s.operationEnds else s.operationEnds ++ [record.readyAt]
    (if declared then .declared else .created, {s with assigned := uid, channel := some record, operationEnds := ends})

def delete (s : State) : Status × State :=
  match s.channel with
  | none => (.missing, s)
  | some r =>
    if r.retiring.isSome then (.missing, s)
    else
      let ends := max s.clock r.readyAt + deleteDelay
      let retiring := {r with retiring := some (s.clock, ends)}
      (.deleted, {s with channel := some retiring, operationEnds := s.operationEnds ++ [ends]})

def step (s : State) (action : Action) (wall : Nat) : Status × State :=
  let current := settle s wall
  match action with
  | .observe => (.observed, current)
  | .create => create current false
  | .declare => create current true
  | .delete => delete current

end ECL
