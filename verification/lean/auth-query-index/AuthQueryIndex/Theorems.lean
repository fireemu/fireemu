import AuthQueryIndex.Spec

namespace AuthQueryIndex

theorem indexed_filter_refinement (users : List Account) (lookup : Expr → List String)
    (expressions : List Expr)
    (complete : ∀ user ∈ users, ∀ expr, (lookup expr).contains user.key = satisfies expr user) :
    fromIndexes users lookup expressions = scan users expressions := by
  unfold fromIndexes scan
  split
  · rfl
  · apply List.filter_congr
    intro user h
    exact congrArg expressions.any (funext (complete user h))

theorem execute_safe (users : List Account) (lookup : Expr → List String)
    (trusted : Bool) (expressions : List Expr)
    (complete : trusted = true →
      ∀ user ∈ users, ∀ expr, (lookup expr).contains user.key = satisfies expr user) :
    execute users lookup trusted expressions = scan users expressions := by
  cases trusted
  · rfl
  · exact indexed_filter_refinement users lookup expressions (complete rfl)

theorem empty_selects_all (users : List Account) (lookup : Expr → List String) (trusted : Bool) :
    execute users lookup trusted [] = users := by
  cases trusted <;> rfl

theorem duplicate_predicate (users : List Account) (expr : Expr) (rest : List Expr) :
    scan users (expr :: expr :: rest) = scan users (expr :: rest) := by
  simp only [scan, List.isEmpty_cons, Bool.false_eq_true, ↓reduceIte, List.any_cons]
  apply List.filter_congr
  intro user _
  cases satisfies expr user <;> simp

theorem folded_kelvin_and_dotted_i :
    satisfies (.email "Kİ@EXAMPLE.COM") ⟨"a", "a", "Kİ@example.com", "", ""⟩ = true := by decide

theorem contextual_sigma_differs_from_medial :
    satisfies (.email "οσ@example.com") ⟨"a", "a", "ΟΣ@example.com", "", ""⟩ = false := by decide

end AuthQueryIndex
