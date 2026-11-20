import Std

namespace PubSubPagination

inductive Policy where
  | strict
  | emulator
  deriving Repr, DecidableEq

inductive Cursor where
  | initial
  | opaque (boundary : String)
  | text (boundary : String)
  deriving Repr, DecidableEq

inductive Error where
  | size
  | cursor
  deriving Repr, DecidableEq

structure Page where
  resources : List String
  next : Option String
  deriving Repr, DecidableEq

def capacity (policy : Policy) (size : Int) (count : Nat) : Option Nat :=
  match policy with
  | .strict =>
    if size < 0 || 1000 < size then none
    else some (if size == 0 then count else size.toNat)
  | .emulator => some (if size ≤ 0 then 1000 else size.toNat)

def first (policy : Policy) (cursor : Cursor) (names : List String) : Option Nat :=
  match policy, cursor with
  | _, .initial => some 0
  | .strict, .opaque boundary => (names.findIdx? (· == boundary)).map (· + 1)
  | .strict, .text _ => none
  | .emulator, .text boundary =>
      some ((names.findIdx? fun n => decide (boundary ≤ n)).getD names.length)
  | .emulator, .opaque _ => none

def window (names : List String) (start size : Nat) : List String × List String :=
  let remaining := names.drop start
  (remaining.take size, remaining.drop size)

def continuation (policy : Policy) (taken rest : List String) : Option String :=
  match rest with
  | [] => none
  | head :: _ => if policy = .strict then taken.getLast? else some head

def page (policy : Policy) (size : Int) (cursor : Cursor) (names : List String) :
    Except Error Page :=
  match capacity policy size names.length with
  | none => .error .size
  | some cap =>
    match first policy cursor names with
    | none => .error .cursor
    | some start =>
      let (taken, rest) := window names start cap
      .ok ⟨taken, continuation policy taken rest⟩

theorem window_partition (names : List String) (start size : Nat) :
    (window names start size).1 ++ (window names start size).2 = names.drop start := by
  exact List.take_append_drop size (names.drop start)

theorem window_capacity (names : List String) (start size : Nat) :
    (window names start size).1.length ≤ size := by
  simp only [window, List.length_take]
  exact Nat.min_le_left _ _

theorem strict_default_is_unlimited (count : Nat) :
    capacity .strict 0 count = some count := by rfl

theorem emulator_default_is_bounded (count : Nat) :
    capacity .emulator 0 count = some 1000 := by rfl

theorem strict_resumes_after_boundary (head : String) (tail : List String) :
    first .strict (.opaque head) (head :: tail) = some 1 := by
  simp [first, List.findIdx?_cons]

theorem emulator_resumes_at_boundary (head : String) (tail : List String) :
    first .emulator (.text head) (head :: tail) = some 0 := by
  simp [first, List.findIdx?_cons]

theorem exhausted_window_has_no_next (policy : Policy) (size : Int) (cursor : Cursor)
    (names : List String) (cap start : Nat)
    (capacityOk : capacity policy size names.length = some cap)
    (startOk : first policy cursor names = some start)
    (exhausted : (window names start cap).2 = []) :
    page policy size cursor names = .ok ⟨(window names start cap).1, none⟩ := by
  simp [page, capacityOk, startOk, exhausted, continuation]

end PubSubPagination

/- Axiom guards for the stated contract laws. -/

/-- info: 'PubSubPagination.window_partition' does not depend on any axioms -/
#guard_msgs in #print axioms PubSubPagination.window_partition

/-- info: 'PubSubPagination.window_capacity' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubPagination.window_capacity

/-- info: 'PubSubPagination.strict_default_is_unlimited' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPagination.strict_default_is_unlimited

/-- info: 'PubSubPagination.emulator_default_is_bounded' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPagination.emulator_default_is_bounded

/-- info: 'PubSubPagination.strict_resumes_after_boundary' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPagination.strict_resumes_after_boundary

/-- info: 'PubSubPagination.emulator_resumes_at_boundary' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPagination.emulator_resumes_at_boundary

/-- info: 'PubSubPagination.exhausted_window_has_no_next' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPagination.exhausted_window_has_no_next
