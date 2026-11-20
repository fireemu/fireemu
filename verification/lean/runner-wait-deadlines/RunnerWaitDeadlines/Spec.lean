import Lean

namespace RunnerWaitDeadlines

def maxSafeInteger : Nat := 9007199254740991
def stallDefault : Nat := 30000
def capDefault : Nat := 10000

inductive NumericInput where
  | integer (value : Int)
  | fraction
  | text (value : String)
  | null
  deriving DecidableEq

def NumericInput.json : NumericInput → Lean.Json
  | .integer n => Lean.toJson n
  | .fraction => .num ⟨15, 1⟩
  | .text s => .str s
  | .null => .null

def nonnegativeSafe : NumericInput → Option Nat
  | .integer value => if 0 ≤ value && value.natAbs ≤ maxSafeInteger then some value.toNat else none
  | _ => none

/-- All corpus sums are below 2^54. Over 2^53, ties are rounded to the even significand. -/
def roundSum (sum : Nat) : Nat :=
  if sum ≤ 2 ^ 53 || sum % 2 = 0 then sum
  else if sum % 4 = 1 then sum - 1 else sum + 1

def quietStall (quiet : NumericInput) (margin : Option NumericInput) : Except String Nat :=
  match nonnegativeSafe quiet, nonnegativeSafe (margin.getD (.integer stallDefault)) with
  | none, _ => .error "a quiet period is a non-negative integer of milliseconds"
  | some period, some (extra + 1) => .ok (roundSum (period + (extra + 1)))
  | _, _ => .error "the margin after a quiet period is a positive integer of milliseconds"

def allowance (lag cap : Nat) : Nat := min (2 * lag) cap

def deadline (base lag : Nat) (cap : Option Nat) : Nat × Bool :=
  let limit := cap.getD capDefault
  (roundSum (base + allowance lag limit), decide (limit < 2 * lag))

structure Config where
  startedAt : Nat
  stall : Nat
  hard : Nat

structure State where
  lastProgress : Nat
  changedAt : Nat
  deriving DecidableEq

structure Sample where
  tick : Nat
  ready : Bool
  failed : Bool
  progress : Nat
  deriving DecidableEq

inductive Result where
  | ready
  | failed
  | stalled
  | hardLimit
  | keepWaiting (state : State)
  deriving DecidableEq

def poll (config : Config) (state : State) (sample : Sample) : Result :=
  if sample.ready then .ready
  else if sample.failed then .failed
  else if sample.progress = state.lastProgress && sample.tick - state.changedAt ≥ config.stall then .stalled
  else if sample.tick - config.startedAt ≥ config.hard then .hardLimit
  else
    .keepWaiting (if sample.progress = state.lastProgress then state else ⟨sample.progress, sample.tick⟩)

inductive Call where
  | check
  | failFast
  | progress
  | sleep

def callsOf : Result → List Call
  | .ready => [.check]
  | .failed => [.check, .failFast]
  | .stalled | .hardLimit => [.check, .failFast, .progress]
  | .keepWaiting _ => [.check, .failFast, .progress, .sleep]

def trace (config : Config) (state : State) : List Sample → Result × Nat × List Call
  | [] => (.keepWaiting state, state.changedAt, [])
  | sample :: remaining =>
    match poll config state sample with
    | .keepWaiting next =>
      let (result, tick, calls) := trace config next remaining
      (result, tick, callsOf (.keepWaiting next) ++ calls)
    | result => (result, sample.tick, callsOf result)

end RunnerWaitDeadlines
