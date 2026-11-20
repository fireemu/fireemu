import Std

namespace RtdbQueryWindow

/-- Index classes in ascending order. Text and numeric comparisons are abstracted by their exact
ranks in the input domain. The corpus uses comparable integer and text representatives. -/
abbrev ValueRank := Int × Int

structure Row where
  keyRank : Nat
  index : ValueRank
  deriving DecidableEq, Repr

abbrev Position := ValueRank × Nat

def Row.position (r : Row) : Position := (r.index, r.keyRank)

def positionOrder (a b : Position) : Ordering :=
  (compare a.1.1 b.1.1).then ((compare a.1.2 b.1.2).then (compare a.2 b.2))

structure Bound where
  position : Position
  inclusive : Bool

inductive Limit where
  | all
  | first (n : Nat)
  | last (n : Nat)

def admit (lower upper : Option Bound) (r : Row) : Bool :=
  lower.all (fun b => let o := positionOrder r.position b.position; o == .gt || (o == .eq && b.inclusive)) &&
  upper.all (fun b => let o := positionOrder r.position b.position; o == .lt || (o == .eq && b.inclusive))

def precedes (a b : Position) : Prop :=
  a.1.1 < b.1.1 ∨
  (a.1.1 = b.1.1 ∧ (a.1.2 < b.1.2 ∨ (a.1.2 = b.1.2 ∧ a.2 ≤ b.2)))

def leRow (a b : Row) : Bool :=
  have : Decidable (precedes a.position b.position) := by unfold precedes; infer_instance
  decide (precedes a.position b.position)

def ordered (xs : List Row) : List Row := xs.mergeSort leRow

theorem leRowTrans (a b c : Row) (ab : leRow a b) (bc : leRow b c) :
    leRow a c := by
  simp only [leRow, decide_eq_true_eq, precedes] at *
  omega

theorem leRowTotal (a b : Row) : leRow a b || leRow b a := by
  simp only [Bool.or_eq_true, leRow, decide_eq_true_eq, precedes]
  omega

def window (xs : List Row) (lower upper : Option Bound) (limit : Limit) : List Row :=
  let inRange := ordered (xs.filter (admit lower upper))
  match limit with
  | .all => inRange
  | .first n => inRange.take n
  | .last n => inRange.drop (inRange.length - n)

theorem firstLength (xs : List Row) (lo hi : Option Bound) (n : Nat) :
    (window xs lo hi (.first n)).length = min n (xs.filter (admit lo hi)).length := by
  simp [window, ordered]

theorem lastLength (xs : List Row) (lo hi : Option Bound) (n : Nat) :
    (window xs lo hi (.last n)).length = min n (xs.filter (admit lo hi)).length := by
  simp [window, ordered]
  omega

theorem admitsEveryRow (xs : List Row) (lo hi : Option Bound) (lim : Limit) (r : Row)
    (h : r ∈ window xs lo hi lim) : r ∈ xs ∧ admit lo hi r = true := by
  have h' : r ∈ ordered (xs.filter (admit lo hi)) := by
    cases lim with
    | all => exact h
    | first n => exact List.mem_of_mem_take h
    | last n => exact List.mem_of_mem_drop h
  simpa [ordered] using h'

theorem windowIsSorted (xs : List Row) (lo hi : Option Bound) (lim : Limit) :
    (window xs lo hi lim).Pairwise (fun a b => leRow a b) := by
  have h := List.pairwise_mergeSort leRowTrans leRowTotal (xs.filter (admit lo hi))
  cases lim with
  | all => exact h
  | first n => exact h.sublist (List.take_sublist n _)
  | last n => exact h.sublist (List.drop_sublist _ _)

theorem noRowsForZeroLimit (xs : List Row) (lo hi : Option Bound) :
    window xs lo hi (.first 0) = [] := by
  simp [window]

/-- info: 'RtdbQueryWindow.firstLength' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms firstLength
/-- info: 'RtdbQueryWindow.lastLength' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms lastLength
/-- info: 'RtdbQueryWindow.admitsEveryRow' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms admitsEveryRow
/-- info: 'RtdbQueryWindow.noRowsForZeroLimit' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms noRowsForZeroLimit
/-- info: 'RtdbQueryWindow.windowIsSorted' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms windowIsSorted

end RtdbQueryWindow
