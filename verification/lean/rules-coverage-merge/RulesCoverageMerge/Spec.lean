import Std

namespace RulesCoverageMerge

def maxCount : Nat := 18446744073709551615

def saturated (a b : Nat) : Nat := min maxCount (a + b)

/-- The summary for one expression extent, in first-seen witness order. -/
structure Summary where
  kept : List (Nat × Nat)
  omitted : Nat
  deriving DecidableEq

def empty : Summary := ⟨[], 0⟩

def hasWitness (summary : Summary) (value : Nat) : Bool :=
  summary.kept.any (fun item => item.1 == value)

def observe (capacity : Nat) (summary : Summary) (value count : Nat) : Summary :=
  if hasWitness summary value then
    { summary with kept := summary.kept.map fun item =>
      if item.1 = value then (value, saturated item.2 count) else item }
  else if summary.kept.length < capacity then
    { summary with kept := summary.kept ++ [(value, count)] }
  else
    { summary with omitted := saturated summary.omitted count }

def record (capacity : Nat) (observations : List Nat) : Summary :=
  observations.foldl (fun acc value => observe capacity acc value 1) empty

def merge (capacity : Nat) (left right : Summary) : Summary :=
  let combined := right.kept.foldl (fun acc item => observe capacity acc item.1 item.2) left
  { combined with omitted := saturated combined.omitted right.omitted }

theorem saturation_bound (a b : Nat) : saturated a b ≤ maxCount := Nat.min_le_left _ _

theorem saturation_at_cap (n : Nat) : saturated maxCount n = maxCount := by
  simp [saturated, Nat.min_eq_left (Nat.le_add_right maxCount n)]

theorem observe_bound (capacity : Nat) (summary : Summary) (value count : Nat)
    (h : summary.kept.length ≤ capacity) :
    (observe capacity summary value count).kept.length ≤ capacity := by
  unfold observe
  split
  · simpa only [List.length_map] using h
  · split
    · simp only [List.length_append, List.length_cons, List.length_nil]
      omega
    · exact h

theorem fold_preserves_bound (capacity : Nat) (items : List (Nat × Nat)) (summary : Summary)
    (h : summary.kept.length ≤ capacity) :
    (items.foldl (fun acc item => observe capacity acc item.1 item.2) summary).kept.length ≤
      capacity := by
  induction items generalizing summary with
  | nil => exact h
  | cons item rest ih => exact ih _ (observe_bound capacity summary item.1 item.2 h)

theorem merge_bound (capacity : Nat) (left right : Summary)
    (h : left.kept.length ≤ capacity) :
    (merge capacity left right).kept.length ≤ capacity :=
  fold_preserves_bound capacity right.kept left h

theorem omitted_bound (capacity : Nat) (left right : Summary) :
    (merge capacity left right).omitted ≤ maxCount := saturation_bound _ _

theorem merge_right_identity (capacity : Nat) (left : Summary)
    (h : left.omitted ≤ maxCount) : merge capacity left empty = left := by
  cases left with
  | mk kept omitted => simp [merge, empty, saturated, Nat.min_eq_right h]

theorem existing_witness_preserves_order (capacity : Nat) (summary : Summary) (value count : Nat)
    (h : hasWitness summary value = true) :
    (observe capacity summary value count).kept.map Prod.fst = summary.kept.map Prod.fst := by
  simp only [observe, h, ↓reduceIte, List.map_map]
  apply List.map_congr_left
  intro item _
  simp only [Function.comp_apply]
  split
  · rename_i equal
    exact equal.symm
  · rfl

theorem saturated_new_witness_is_only_omitted (capacity : Nat) (summary : Summary)
    (value count : Nat) (h : capacity ≤ summary.kept.length)
    (fresh : hasWitness summary value = false) :
    observe capacity summary value count =
    { summary with omitted := saturated summary.omitted count } := by
  simp [observe, fresh, Nat.not_lt_of_ge h]

/-- At cap two, the middle batch forgets a value whose count the outer left batch could keep. -/
theorem merge_association_can_lose_a_retained_count :
    let a := record 2 [9]
    let b := record 2 [0, 1]
    let c := record 2 [9]
    (merge 2 (merge 2 a b) c = ⟨[(9, 2), (0, 1)], 1⟩) ∧
    (merge 2 a (merge 2 b c) = ⟨[(9, 1), (0, 1)], 2⟩) := by decide

end RulesCoverageMerge
