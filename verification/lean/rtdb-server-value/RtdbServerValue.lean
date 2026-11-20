import Std

namespace RtdbServerValue

inductive Number where
  | int (n : Int)
  | double (bits : UInt64)
  deriving DecidableEq, Repr

inductive Operation where
  | timestamp
  | increment (delta : Number)
  | malformed

/-- On-the-wire numbers enter as i64 or finite binary64. The executable uses the logically
defined IEEE model rather than calling the host floating-point adder. -/
def Number.asFloat : Number → Float.Model
  | .int n => .ofInt n
  | .double bits => .ofBits bits

-- The node parser widens a number embedded in a stored JSON priority to binary64.
def embeddedPriorityBase : Option Number → Option Number
  | some (.int n) => some (.double (Float.Model.ofInt n).toBits)
  | base => base

def minI64 : Int := -9223372036854775808
def maxI64 : Int := 9223372036854775807

def addFloat (a b : Number) : Number :=
  let result := a.asFloat + b.asFloat
  if result.isFinite then .double result.toBits
  else .double ((result.toBits &&& 0x8000000000000000) ||| 0x7fefffffffffffff)

def add (a b : Number) : Number :=
  match a, b with
  | .int lhs, .int rhs =>
    if minI64 ≤ lhs + rhs ∧ lhs + rhs ≤ maxI64 then .int (lhs + rhs)
    else addFloat a b
  | _, _ => addFloat a b

/-- Pick the current number at the resolved slot. Null, absent and nonnumeric values all
use the same resolution rule. A stored priority is read separately from the stored value. -/
def resolve (op : Operation) (existing : Option Number) (now : Int) : Option Number :=
  match op with
  | .timestamp => some (.int now)
  | .increment delta => some ((existing.map (add · delta)).getD delta)
  | .malformed => none

theorem timestampIgnoresValue (a b : Option Number) (now : Int) :
    resolve .timestamp a now = resolve .timestamp b now := by rfl

theorem timestampUsesContext (old : Option Number) (now : Int) :
    resolve .timestamp old now = some (.int now) := by rfl

theorem defaultBase (delta : Number) (now : Int) :
    resolve (.increment delta) none now = some delta := by rfl

theorem incrementIgnoresClock (delta : Number) (old : Option Number) (a b : Int) :
    resolve (.increment delta) old a = resolve (.increment delta) old b := by rfl

theorem exactInteger (lhs rhs now : Int) (low : minI64 ≤ lhs + rhs)
    (high : lhs + rhs ≤ maxI64) :
    resolve (.increment (.int rhs)) (some (.int lhs)) now = some (.int (lhs + rhs)) := by
  simp [resolve, add, low, high]

theorem incrementEmbeddedPriority (base : Int) (delta : Number) (now : Int) :
    resolve (.increment delta) (embeddedPriorityBase (some (.int base))) now =
      some (addFloat (.double (Float.Model.ofInt base).toBits) delta) := by rfl

theorem embeddedPriorityKeepsAbsent :
    embeddedPriorityBase none = none := by rfl

theorem malformedHasNoResult (old : Option Number) (now : Int) :
    resolve .malformed old now = none := by rfl

/-- info: 'RtdbServerValue.timestampIgnoresValue' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms timestampIgnoresValue
/-- info: 'RtdbServerValue.timestampUsesContext' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms timestampUsesContext
/-- info: 'RtdbServerValue.defaultBase' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms defaultBase
/-- info: 'RtdbServerValue.incrementIgnoresClock' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms incrementIgnoresClock
/-- info: 'RtdbServerValue.exactInteger' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms exactInteger
/-- info: 'RtdbServerValue.malformedHasNoResult' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms malformedHasNoResult

/-- info: 'RtdbServerValue.incrementEmbeddedPriority' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms incrementEmbeddedPriority
/-- info: 'RtdbServerValue.embeddedPriorityKeepsAbsent' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms embeddedPriorityKeepsAbsent

end RtdbServerValue
