import Std

namespace RulesUtf16Slices

inductive Profile where
  | production | official
  deriving DecidableEq

inductive Selection where
  | text (units : List Nat)
  | fragment (unit : Nat)
  | invalidIndex
  | invalidRange
  | cutPair
  deriving DecidableEq

def pair (first second : Nat) : Bool :=
  decide (0xd800 ≤ first ∧ first < 0xdc00 ∧ 0xdc00 ≤ second ∧ second < 0xe000)

/-- A UTF-16 pair can only be split at the boundary between its two adjacent units. -/
def splits (units : List Nat) (boundary : Nat) : Bool :=
  if 0 < boundary ∧ boundary < units.length then
    pair (units[boundary - 1]?.getD 0) (units[boundary]?.getD 0)
  else false

def window (units : List Nat) (lower upper : Nat) : List Nat :=
  (units.drop lower).take (upper - lower)

/-- A valid nonempty range cuts a pair only at one of its endpoints. An originally lone unit
is text in both profiles. A production fragment is a distinct nontext observation. -/
def select (profile : Profile) (units : List Nat) (lower upper : Nat) : Selection :=
  let chosen := window units lower upper
  if profile = .production ∧ lower < upper ∧ (splits units lower || splits units upper) = true then
    match chosen with
    | [unit] => .fragment unit
    | _ => .cutPair
  else .text chosen

def index (profile : Profile) (units : List Nat) (i : Int) : Selection :=
  if 0 ≤ i ∧ i < (units.length : Int) then
    select profile units i.toNat (i.toNat + 1)
  else .invalidIndex

def slice (profile : Profile) (units : List Nat) (lower upper : Int) : Selection :=
  if 0 ≤ lower ∧ lower < (units.length : Int) ∧ 0 < upper ∧
      upper ≤ (units.length : Int) ∧ lower ≤ upper then
    select profile units lower.toNat upper.toNat
  else .invalidRange

theorem left_edge_never_cuts (units : List Nat) : splits units 0 = false := by
  simp [splits]

theorem right_edge_never_cuts (units : List Nat) : splits units units.length = false := by
  simp [splits]

theorem full_slice_keeps_units (profile : Profile) (units : List Nat) (h : units ≠ []) :
    slice profile units 0 units.length = .text units := by
  simp [slice, select, window, h, left_edge_never_cuts, right_edge_never_cuts]

theorem interior_empty_slice (profile : Profile) (units : List Nat) (position : Nat)
    (positive : 0 < position) (inside : position < units.length) :
    slice profile units position position = .text [] := by
  have hhi : (position : Int) < units.length := by omega
  simp [slice, select, window, Nat.ne_of_gt positive, hhi, Int.le_of_lt hhi]

theorem empty_at_zero_rejected (profile : Profile) (units : List Nat) :
    slice profile units 0 0 = .invalidRange := by
  simp [slice]

theorem official_selection_keeps_exact_width (units : List Nat) (lower upper : Nat)
    (h : upper ≤ units.length) :
    ∃ chosen, select .official units lower upper = .text chosen ∧ chosen.length = upper - lower := by
  refine ⟨window units lower upper, ?_, ?_⟩
  · simp [select]
  · simp only [window, List.length_take, List.length_drop]
    exact Nat.min_eq_left (by omega)

theorem uncut_selection_same_in_both_profiles (units : List Nat) (lower upper : Nat)
    (hl : splits units lower = false) (hu : splits units upper = false) :
    select .production units lower upper = select .official units lower upper := by
  simp [select, hl, hu]

theorem cut_pair_regression :
    index .production [0xd83d, 0xde00] 0 = .fragment 0xd83d ∧
    index .official [0xd83d, 0xde00] 0 = .text [0xd83d] ∧
    index .production [0xd83d, 120] 0 = .text [0xd83d] ∧
    slice .production [97, 0xd83d, 0xde00] 0 2 = .cutPair := by decide

end RulesUtf16Slices
