import PythonRunnerWireLayout.Spec

namespace PyWire

theorem ordering_preserves_fields (layout : Layout) (gcsRoot : Bool)
    (fields : List (String × Value)) :
    (orderedFields layout gcsRoot fields).Perm fields := by
  cases layout <;> cases gcsRoot <;> simp only [orderedFields]
  · exact List.Perm.refl _
  · exact List.Perm.refl _
  all_goals exact List.mergeSort_perm _ _

theorem compact_order (root : Bool) (fields : List (String × Value)) :
    orderedFields .compact root fields = fields := rfl

theorem pubsub_fields_are_sorted (root : Bool) (fields : List (String × Value)) :
    (orderedFields .pubsub root fields).Pairwise (fun a b => lexical a b = true) := by
  apply List.pairwise_mergeSort
  · intro a b c hab hbc
    simp only [lexical, decide_eq_true_eq] at hab hbc ⊢
    exact Std.le_trans hab hbc
  · intro a b
    simpa [lexical] using (show a.1 ≤ b.1 ∨ b.1 ≤ a.1 from Std.le_total)

theorem nested_storage_fields_are_sorted (fields : List (String × Value)) :
    (orderedFields .storage false fields).Pairwise (fun a b => lexical a b = true) :=
  pubsub_fields_are_sorted false fields

theorem numeric_wire_lexeme (layout : Layout) (root : Bool) (depth fuel : Nat) (token : String) :
    write layout root depth (fuel + 1) (.number token) = token := rfl

theorem numeric_body_lexeme (layout : Layout) (fuel : Nat) (token : String) :
    render layout (fuel + 1) (.number token) =
      token ++ (if layout == .compact then "" else "\n") := by
  cases layout <;> simp [render, write, prettyOriginal]

theorem empty_aggregates_stay_single_line (layout : Layout) (root : Bool) (depth fuel : Nat) :
    write layout root depth (fuel + 1) (.array []) = "[]" ∧
    write layout root depth (fuel + 1) (.object []) = "{}" := by
  cases layout <;> cases root <;> simp [write, join, orderedFields]

theorem known_before_unknown (known unknown : String) (a b : Value)
    (hk : storageKeys.idxOf known < storageKeys.length)
    (hu : storageKeys.idxOf unknown = storageKeys.length) :
    gcsOrder (known, a) (unknown, b) = true := by
  have h : storageKeys.idxOf known < storageKeys.idxOf unknown := by omega
  simp [gcsOrder, h]

theorem unknown_members_use_lexical_order (a b : String) (v w : Value)
    (ha : storageKeys.idxOf a = storageKeys.length)
    (hb : storageKeys.idxOf b = storageKeys.length) :
    gcsOrder (a, v) (b, w) = lexical (a, v) (b, w) := by
  simp [gcsOrder, ha, hb]

end PyWire
