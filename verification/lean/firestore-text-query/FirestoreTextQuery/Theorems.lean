import FirestoreTextQuery.Spec

namespace FirestoreTextQuery

theorem empty_plain_has_no_hits (indexed : List String) (fields : Fields) :
    membership indexed (.plain []) fields = .miss := by
  simp [membership, plainMatches]

theorem one_plain_token_uses_exact_membership (fields : Fields) (term : String) :
    plainMatches fields [term] = termOccurs fields term := by
  simp [plainMatches]

theorem all_negative_has_no_hits (indexed : List String) (fields : Fields) (clauses : List Clause)
    (known : covered indexed clauses = true) (negative : ∀ c ∈ clauses, c.excludes = true) :
    membership indexed (.legacy clauses) fields = .miss := by
  have noPositive : clauses.any (fun c => !c.excludes) = false := by
    cases h : clauses.any (fun c => !c.excludes)
    · rfl
    · rw [List.any_eq_true] at h
      obtain ⟨c, member, positive⟩ := h
      simp [negative c member] at positive
  simp [membership, known, noPositive]

theorem unknown_field_has_priority (indexed : List String) (fields : Fields) (clauses : List Clause)
    (unknown : covered indexed clauses = false) :
    membership indexed (.legacy clauses) fields = .unknown := by
  simp [membership, unknown]

theorem page_never_exceeds_requested_limit {α : Type} (newest : List α)
    (depth : Option Nat) (offset limit : Nat) :
    (page newest depth offset (some limit)).length ≤ limit := by
  simp [page, List.length_take]
  exact Nat.min_le_left ..

theorem selection_precedes_offset {α : Type} (newest : List α) (depth offset : Nat)
    (limit : Option Nat) (h : depth ≤ offset) :
    page newest (some depth) offset limit = [] := by
  unfold page
  simp only [Option.map_some, Option.getD_some]
  have enough : (newest.take depth).length ≤ offset := by
    rw [List.length_take]
    exact Nat.le_trans (Nat.min_le_left ..) h
  rw [List.drop_eq_nil_iff.mpr enough]
  simp

theorem split_fields_are_conjunctive_but_not_a_phrase :
    plainMatches [("title", ["red"]), ("body", ["fox"])] ["red", "fox"] = true ∧
    clauseMatches [("title", ["red"]), ("body", ["fox"])] ⟨none, ["red", "fox"], false⟩ = false := by
  decide

theorem concatenation_is_exact_and_ordered :
    plainMatches [("body", ["redfox"])] ["red", "fox"] = true ∧
    plainMatches [("body", ["redfox"])] ["fox", "red"] = false ∧
    plainMatches [("body", ["redfoxes"])] ["red", "fox"] = false := by
  decide

theorem field_restriction_does_not_use_phrases_from_another_field :
    clauseMatches [("title", ["red"]), ("body", ["red", "fox"])]
      ⟨some "title", ["red", "fox"], false⟩ = false := by
  decide

end FirestoreTextQuery
