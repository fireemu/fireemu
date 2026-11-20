import FirestoreAggregates.Spec

namespace FirestoreAggregates

theorem integer_add_is_exact_within_bounds (a b : Int)
    (fits : minI64 ≤ a + b ∧ a + b ≤ maxI64) :
    plus (.whole a) (.whole b) = .whole (a + b) := by
  simp only [plus, ite_eq_left fits]

theorem integer_add_promotes_on_overflow (a b : Int)
    (outside : ¬(minI64 ≤ a + b ∧ a + b ≤ maxI64)) :
    (plus (.whole a) (.whole b)).isDouble = true := by
  simp only [plus, ite_eq_right outside, Number.isDouble]

theorem promoted_accumulator_stays_promoted (value : Float) (items : List Number) :
    (items.foldl plus (.double value)).isDouble = true := by
  induction items generalizing value with
  | nil => rfl
  | cons head tail more =>
    change (tail.foldl plus (plus (.double value) head)).isDouble = true
    cases head <;> exact more _

theorem selected_rows_meet_all_requirements (query : Request) (rows : List Row)
    (row : Row) (h : row ∈ selected query rows) :
    row.visible = true ∧
      (query.requireX = true → row.x.present = true) ∧
      (query.requireY = true → row.y.present = true) ∧
      (query.requireRank = true → row.rankPresent = true) := by
  have ordered : row ∈ sourceRows query rows := by
    unfold selected at h
    cases limit : query.limit with
    | none =>
      simp only [limit, Option.elim_none] at h
      exact List.mem_of_mem_drop h
    | some count =>
      simp only [limit, Option.elim_some] at h
      exact List.mem_of_mem_drop (List.mem_of_mem_take h)
  have filtered : row ∈ rows.filter (eligible query) := by
    unfold sourceRows at ordered
    split at ordered
    · simpa using ordered
    · exact ordered
  have meets := (List.mem_filter.mp filtered).2
  cases hx : query.requireX <;> cases hy : query.requireY <;>
    cases hr : query.requireRank <;> simp_all [eligible, and_assoc]

theorem count_capped_on_both_sides (cap count : Nat) :
    countUpTo (some cap) count ≤ cap ∧ countUpTo (some cap) count ≤ count := by
  exact ⟨Nat.min_le_right _ _, Nat.min_le_left _ _⟩

theorem empty_sum : sum [] = .whole 0 := rfl

theorem empty_average : average [] = none := rfl

theorem numeric_inputs_cannot_outnumber_rows (field : Row → Entry) (rows : List Row) :
    (contributors field rows).length ≤ rows.length :=
  List.length_filterMap_le _ _

end FirestoreAggregates
