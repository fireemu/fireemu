import Std

namespace AppCheckRegistryModel

inductive App where
  | first | second | unknown
  deriving DecidableEq, Repr

inductive Scope where
  | none | first | second | both
  deriving DecidableEq, Repr

def accepts (scope : Scope) (app : App) : Bool :=
  match scope, app with
  | .first, .first | .second, .second | .both, .first | .both, .second => true
  | _, _ => false

structure Record where
  id : Nat
  label : String
  time : Nat
  deriving DecidableEq, Repr

structure Registry where
  staticFirst : Nat
  live : App → List Record
  nextId : Nat

def initial (count : Nat) : Registry := ⟨count, fun _ => [], 1⟩

def update (old : App → List Record) (app : App) (records : List Record) : App → List Record :=
  fun key => if key = app then records else old key

def staticCount (registry : Registry) (app : App) : Nat :=
  if app == .first then registry.staticFirst else 0

def add (registry : Registry) (app : App) (label : String) (time : Nat) :
    Option Record × Registry :=
  let next := {registry with nextId := registry.nextId + 1}
  if staticCount registry app + (registry.live app).length ≥ 128 then (none, next)
  else
    let record := ⟨registry.nextId, label, time⟩
    (some record, {next with live := update registry.live app (registry.live app ++ [record])})

def dropToken (registry : Registry) (app : App) (record : Option Record) : Bool × Registry :=
  match record with
  | none => (false, registry)
  | some record =>
    if (registry.live app).any (fun r => r.id == record.id) then
      (true, {registry with live := update registry.live app ((registry.live app).filter
        fun r => r.id != record.id)})
    else (false, registry)

def clear (registry : Registry) (app : App) : Registry :=
  {registry with live := update registry.live app []}

def capture (registry : Registry) (scope : Scope) : App → Option (List Record) :=
  fun app => if accepts scope app then some (registry.live app) else none

def restore (registry : Registry) (scope : Scope) (snapshot : App → Option (List Record)) : Registry :=
  {registry with live := fun app => if accepts scope app then (snapshot app).getD [] else registry.live app}

structure EpochState where
  value : Option Nat
  generation : Nat
  session : Nat
  deriving DecidableEq, Repr

def rotate (state : EpochState) (epoch : Nat) : EpochState :=
  ⟨some epoch, state.generation + 1, 0⟩

inductive Refusal where
  | unknown | disabled | noEpoch
  deriving DecidableEq, Repr

def issue (state : EpochState) (app : App) : Except Refusal (Nat × Nat) × EpochState :=
  match app with
  | .unknown => (.error .unknown, state)
  | .second => (.error .disabled, state)
  | .first =>
    match state.value with
    | none => (.error .noEpoch, state)
    | some epoch => (.ok (epoch, state.session + 1), {state with session := state.session + 1})

end AppCheckRegistryModel
