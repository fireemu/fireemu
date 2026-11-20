import Std

namespace CTAdmission

inductive Unknown where
  | none | request | task | http
  deriving DecidableEq, Repr

def Unknown.label : Unknown → String
  | .none => "none" | .request => "request" | .task => "task" | .http => "http"

inductive Syntax where
  | valid | schedule | deadline | both
  deriving DecidableEq, Repr

def Syntax.label : Syntax → String
  | .valid => "valid" | .schedule => "schedule" | .deadline => "deadline" | .both => "both"

inductive Name where
  | valid | generated | shape | id | queue
  deriving DecidableEq, Repr

structure Fields where
  payload : Bool := true
  name : Name := .valid
  deadline : Option Int := none
  schedule : Option Int := none
  bytes : Nat := 0
  full : Bool := false
  deriving DecidableEq, Repr

structure Accepted where
  schedule : Int
  deadlineSeconds : Int
  full : Bool
  deriving DecidableEq, Repr

def minimumDeadline : Int := 15000000000
def maximumDeadline : Int := 1800000000000
def horizon : Int := 2592000000000000
def maxBytes : Nat := 1048576

def scheduleFor (now : Int) (instant : Option Int) : Int :=
  let chosen := max now (instant.getD now)
  chosen - chosen % 1000

def deadlineFor (defaultSeconds : Int) (deadline : Option Int) : Int :=
  match deadline with
  | none | some 0 => defaultSeconds
  | some d => (d + 999999999) / 1000000000

def nameError : Name → Option String
  | .valid | .generated => none
  | .shape => some "nameShape"
  | .id => some "nameId"
  | .queue => some "nameQueue"

def precheck (unknown : Unknown) (syntaxState : Syntax) (fields : Fields) (now : Int) : Option String :=
  match unknown, syntaxState with
  | .request, _ => some "unknownRequest"
  | .task, _ => some "unknownTask"
  | .http, _ => some "unknownHttp"
  | .none, .schedule => some "scheduleSyntax"
  | .none, .deadline => some "deadlineSyntax"
  | .none, .both => some "bothSyntax"
  | .none, .valid =>
    if !fields.payload then some "payload"
    else if let some reason := nameError fields.name then some reason
    else if fields.deadline.any (fun d => d ≠ 0 ∧ (d < minimumDeadline ∨ maximumDeadline < d)) then
      some "deadlineRange"
    else if fields.schedule.any (fun instant => horizon < instant - now) then some "horizon"
    else none

/-- The first component models whether the deferred size measure was evaluated. -/
def admit (unknown : Unknown) (syntaxState : Syntax) (fields : Fields) (now defaultSeconds : Int) :
    Bool × Except String Accepted :=
  match precheck unknown syntaxState fields now with
  | some reason => (false, .error reason)
  | none =>
    (true, if fields.bytes > maxBytes then .error "size"
      else .ok ⟨scheduleFor now fields.schedule, deadlineFor defaultSeconds fields.deadline, fields.full⟩)

def now : Int := 1234567890

def scenarios : List (String × Fields) := [
  ("defaults", {}), ("generated", {name := .generated}), ("zero", {deadline := some 0}),
  ("minimum", {deadline := some minimumDeadline}), ("maximum", {deadline := some maximumDeadline}),
  ("below", {deadline := some (minimumDeadline - 1)}), ("above", {deadline := some (maximumDeadline + 1)}),
  ("fractional", {deadline := some (minimumDeadline + 1)}), ("past", {schedule := some 0}),
  ("near", {schedule := some 1234568105}), ("horizon", {schedule := some (now + horizon)}),
  ("beyond", {schedule := some (now + horizon + 1)}), ("missingPayload", {payload := false}),
  ("nullPayload", {}), ("appEngine", {}), ("badShape", {name := .shape}),
  ("badId", {name := .id}), ("wrongQueue", {name := .queue}), ("exactBytes", {bytes := maxBytes}),
  ("large", {bytes := maxBytes + 1}), ("fullView", {full := true}),
  ("payloadWins", {payload := false, name := .shape, deadline := some (-1), bytes := maxBytes + 1}),
  ("nameWins", {name := .queue, deadline := some (-1), schedule := some (now + horizon + 1)}),
  ("deadlineWins", {deadline := some (-1), schedule := some (now + horizon + 1), bytes := maxBytes + 1}),
  ("horizonWins", {schedule := some (now + horizon + 1), bytes := maxBytes + 1})
]

end CTAdmission
