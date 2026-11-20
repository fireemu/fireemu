import Std

namespace PubSubFilter

inductive Expr where
  | exists (key : String)
  | equal (key value : String)
  | unequal (key value : String)
  | prefix (key value : String)
  | neg (expr : Expr)
  | both (left right : Expr)
  | either (left right : Expr)
  deriving Repr

abbrev Attributes := String → Option String

def eval (attrs : Attributes) : Expr → Bool
  | .exists key => (attrs key).isSome
  | .equal key value => attrs key == some value
  | .unequal key value => !(attrs key == some value)
  | .prefix key value => (attrs key).any (·.startsWith value)
  | .neg expr => !eval attrs expr
  | .both left right => eval attrs left && eval attrs right
  | .either left right => eval attrs left || eval attrs right

def allows (attrs : Attributes) (filter : Option Expr) : Bool :=
  filter.all (eval attrs)

theorem unequal_is_complement (attrs : Attributes) (key value : String) :
    eval attrs (.unequal key value) = eval attrs (.neg (.equal key value)) := rfl

theorem equality_requires_presence (attrs : Attributes) (key value : String) :
    eval attrs (.equal key value) = true → eval attrs (.exists key) = true := by
  cases h : attrs key <;> simp [eval, h]

theorem absent_unequal_but_no_prefix (attrs : Attributes) (key value : String)
    (absent : attrs key = none) :
    eval attrs (.unequal key value) = true ∧ eval attrs (.prefix key value) = false := by
  simp [eval, absent]

theorem deMorgan (attrs : Attributes) (left right : Expr) :
    eval attrs (.neg (.both left right)) =
      eval attrs (.either (.neg left) (.neg right)) := by
  cases hl : eval attrs left <;> cases hr : eval attrs right <;>
    simp [eval, hl, hr]

theorem empty_filter_admits (attrs : Attributes) : allows attrs none = true := rfl

end PubSubFilter

/- Axiom guards for the stated contract laws. -/

/-- info: 'PubSubFilter.unequal_is_complement' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubFilter.unequal_is_complement

/-- info: 'PubSubFilter.equality_requires_presence' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubFilter.equality_requires_presence

/-- info: 'PubSubFilter.absent_unequal_but_no_prefix' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubFilter.absent_unequal_but_no_prefix

/-- info: 'PubSubFilter.deMorgan' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubFilter.deMorgan

/-- info: 'PubSubFilter.empty_filter_admits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubFilter.empty_filter_admits
