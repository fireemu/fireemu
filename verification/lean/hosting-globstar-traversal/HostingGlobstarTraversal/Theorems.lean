import HostingGlobstarTraversal.Spec

namespace HostingGlobstarTraversal

private theorem any_guard (guard : Bool) (p : α → Bool) (xs : List α) :
    xs.any (fun x => guard && p x) = (guard && xs.any p) := by
  cases guard <;> simp

private theorem cons_consumes (hidden : α → Bool) (dot : Bool) (first : α)
    (rest : List α) :
    canConsume hidden dot (first :: rest) =
      ((dot || !hidden first) && canConsume hidden dot rest) := by
  cases dot <;> cases h : hidden first <;> simp [canConsume, h]

theorem traversal_agrees_with_split_search (hidden : α → Bool) (dot : Bool)
    (accepts : List α → Bool) (path : List α) :
    traverses hidden dot accepts path = declarative hidden dot accepts path := by
  induction path with
  | nil => simp [traverses, declarative, splits, canConsume]
  | cons first rest ih =>
    simp only [traverses, declarative, splits, List.any_cons, List.any_map,
      show canConsume hidden dot [] = true by simp [canConsume], Bool.true_and]
    change (accepts (first :: rest) || (dot || !hidden first) && traverses hidden dot accepts rest) =
      (accepts (first :: rest) || (splits rest).any
        (fun x => canConsume hidden dot (first :: x.1) && accepts x.2))
    simp only [cons_consumes, Bool.and_assoc]
    rw [any_guard (dot || !hidden first)
      (fun x : List α × List α => canConsume hidden dot x.1 && accepts x.2)
      (splits rest), ih]
    rfl

theorem globstar_checks_hidden_without_consuming_it (hidden : α → Bool)
    (accepts : List α → Bool) (first : α) (rest : List α) (h : hidden first = true) :
    traverses hidden false accepts (first :: rest) = accepts (first :: rest) := by
  simp [traverses, h]

theorem accepting_the_original_path_needs_no_consumption (hidden : α → Bool)
    (dot : Bool) (accepts : List α → Bool) (path : List α)
    (h : accepts path = true) : traverses hidden dot accepts path = true := by
  cases path <;> simp [traverses, h]

end HostingGlobstarTraversal
