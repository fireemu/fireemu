import StoragePrecondition.Spec

namespace SP

/-- The list represents the populated fields of Rust's `Precondition`, in written order.
Each field occurs at most once in the public API inputs. The status model also works for
repeated fields by treating them as additional guards. -/
def check (current : Current) (guards : List Guard) : Decision :=
  match current with
  | none =>
    if guards.any (fun | .generationMatch n => n != 0 | _ => true) then .failed
    else .proceed
  | some o =>
    if guards.any (fun
        | .generationMatch n => o.generation != n
        | .metagenerationMatch n => o.metageneration != n
        | _ => false) then .failed
    else if guards.any (fun
        | .generationNotMatch n => o.generation == n
        | .metagenerationNotMatch n => o.metageneration == n
        | _ => false) then .notModified
    else .proceed

/-- The lookup/check sequence of the read, live metadata update, put and live delete paths. -/
def decideOp (op : Op) (current : Current) (guards : List Guard) : Decision :=
  if op ≠ .upload ∧ op ≠ .finalize ∧ current = none then .notFound
  else check current guards

def maxIdentity : Nat := 9223372036854775807

def maxU64 : Nat := 18446744073709551615

structure State where
  current : Current
  lastGeneration : Nat
  deriving DecidableEq, Repr

/-- `next_generation_preview`: a checked successor, optionally floored by epoch
microseconds, then checked against the persisted identity ceiling. A microsecond value
outside u64 converts to zero. -/
def nextGeneration (last : Nat) (production : Bool) (now : Int) : Option Nat :=
  if last + 1 > maxU64 then none
  else
    let micros := now / 1000
    let floor := if 0 ≤ micros ∧ micros ≤ Int.ofNat maxU64 then micros.toNat else 0
    let drawn := if production then max (last + 1) floor else last + 1
    if drawn ≤ maxIdentity then some drawn else none

inductive Result where
  | applied (returned : ObjectId)
  | refused (decision : Decision)
  | identityExhausted
  deriving DecidableEq, Repr

/-- Object state after the guard gate. Payloads and all other admission checks are assumed
valid. Only body replacement changes the generation counter. -/
def step (s : State) (op : Op) (guards : List Guard) (production : Bool) (now : Int) :
    Result × State :=
  match decideOp op s.current guards with
  | .proceed =>
    match op with
    | .upload | .finalize =>
      match nextGeneration s.lastGeneration production now with
      | some g =>
        let next : ObjectId := ⟨g, 1⟩
        (.applied next, ⟨some next, g⟩)
      | none => (.identityExhausted, s)
    | .read | .delete | .metadata =>
      match s.current with
      | none => (.refused .notFound, s)
      | some o =>
        match op with
        | .read => (.applied o, s)
        | .delete => (.applied o, { s with current := none })
        | _ =>
          let m := o.metageneration + 1
          if m ≤ maxIdentity then
            let next := { o with metageneration := m }
            (.applied next, { s with current := some next })
          else (.identityExhausted, s)
  | answer => (.refused answer, s)

inductive Phase where
  | receiving | aborted | committed
  deriving DecidableEq, Repr

/-- A receiving session with valid bytes is terminal on a guard or identity refusal
from `plan_put`. Aborting clears the payload. -/
def finalizePhase : Result → Phase
  | .applied _ => .committed
  | _ => .aborted

end SP
