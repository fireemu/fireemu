import Std

namespace CTQ

inductive Reuse where
  | immediate | retained | window
  deriving DecidableEq, Repr

inductive Schedule where
  | none | future | release
  deriving DecidableEq, Repr

inductive Phase where
  | free
  | pending (id : Nat) (forced : Bool)
  | active (id : Nat)
  | finished (tick : Nat)
  deriving DecidableEq, Repr

structure Stamp where
  id : Nat
  generation : Nat
  deriving DecidableEq, Repr

structure State where
  generation : Nat := 0
  nextId : Nat := 0
  closed : Bool := false
  phase : Phase := .free
  first : Option Stamp := none
  latest : Option Stamp := none
  deriving DecidableEq, Repr

def observe (reuse : Reuse) (time : Nat) : Phase → Phase
  | .finished since =>
    if reuse == .immediate || (reuse == .window && time - since ≥ 2) then .free else .finished since
  | phase => phase

def release (reuse : Reuse) (time : Nat) : Phase :=
  if reuse == .immediate then .free else .finished time

def complete (reuse : Reuse) (time : Nat) (s : State) (stamp : Option Stamp) : Bool × State :=
  match s.phase, stamp with
  | .active id, some mark =>
    if mark.generation == s.generation && mark.id == id then
      (true, {s with phase := release reuse time})
    else (false, s)
  | _, _ => (false, s)

def reset (s : State) : State :=
  {s with generation := s.generation + 1, phase := .free}

def status : Phase → String
  | .free => "free"
  | .pending .. | .active .. => "live"
  | .finished _ => "finished"

def activeCount : Phase → Nat
  | .active _ => 1 | _ => 0

def outstanding : Phase → Nat
  | .pending .. | .active .. => 1 | _ => 0

inductive Op where
  | enqueue | poll | runNow | finish | finishFirst | staleGeneration | delete | reset | close | peek
  deriving DecidableEq, Repr

def Op.label : Op → String
  | .enqueue => "enqueue" | .poll => "poll" | .runNow => "runNow"
  | .finish => "finish" | .finishFirst => "finishFirst"
  | .staleGeneration => "staleGeneration" | .delete => "delete"
  | .reset => "reset" | .close => "close" | .peek => "peek"

def perform (reuse : Reuse) (schedule : Schedule) (time : Nat) (op : Op) (s : State) : String × State :=
  let s := {s with phase := observe reuse time s.phase}
  match op with
  | .enqueue =>
    if s.closed then ("closed", s)
    else if s.phase != .free then ("duplicate", s)
    else
      let id := s.nextId + 1
      ("accepted", {s with nextId := id, phase := .pending id false})
  | .poll =>
    match s.phase with
    | .pending id forced =>
      if forced || schedule == .none || time ≥ 5 then
        let mark : Stamp := ⟨id, s.generation⟩
        let first := s.first.orElse (fun _ => some mark)
        (s!"{id}+{mark.generation}", {s with phase := .active id, first, latest := some mark})
      else ("none", s)
    | _ => ("none", s)
  | .runNow =>
    match s.phase with
    | .pending id false => ("1", {s with phase := .pending id true})
    | _ => ("0", s)
  | .finish | .finishFirst =>
    let (removed, next) := complete reuse time s (if op == .finish then s.latest else s.first)
    (toString removed, next)
  | .staleGeneration =>
    let stale := (s.latest.filter (fun mark => mark.generation > 0)).map fun mark =>
      {mark with generation := mark.generation - 1}
    let (removed, next) := complete reuse time s stale
    (toString removed, next)
  | .delete =>
    match s.phase with
    | .pending .. => ("true", {s with phase := release reuse time})
    | _ => ("false", s)
  | .reset => ("-", reset s)
  | .close => ("-", {reset s with closed := true})
  | .peek => ("-", s)

def trace (reuse : Reuse) (schedule : Schedule) : List (Nat × Op) → State → List String
  | [], _ => []
  | (time, op) :: tail, before =>
    let (result, after) := perform reuse schedule time op before
    let phase := observe reuse time after.phase
    let row := s!"{time}:{op.label}:{result}:{status phase}:{activeCount phase}:{outstanding phase}"
    row :: trace reuse schedule tail {after with phase}

def timeline (disposal : Op) (schedule : Schedule) (age : Nat) : List (Nat × Op) :=
  let disposedAt := if disposal == .delete then 4 else 5
  let reuseAt := disposedAt + age
  [(0, .enqueue), (0, .enqueue)] ++
  (if disposal == .delete then [] else
    [(0, .poll)] ++ (if schedule == .release then [(0, .runNow), (0, .runNow), (0, .poll)] else []) ++
    [(4, .poll), (5, .poll), (5, .delete)]) ++
  [(disposedAt, disposal), (disposedAt, .peek), (reuseAt, .peek), (reuseAt, .enqueue), (reuseAt, .poll),
   (reuseAt, .finishFirst), (reuseAt, .staleGeneration), (reuseAt, .finish), (reuseAt, .peek)]

def reuseCases : List (String × Reuse) := [("immediate", .immediate), ("retained", .retained), ("window", .window)]
def scheduleCases : List (String × Schedule) := [("now", .none), ("future", .future), ("release", .release)]

end CTQ
