import AuthUserPagination.Spec

namespace AuthUserPagination

theorem ties_keep_uid (field : Field) (dir : Bool) (a b : User)
    (tie : byField field a b = .eq) :
    stableCompare field dir a b = compare a.uid b.uid := by
  simp [stableCompare, tie]

theorem first_keys_ignore_cut_tail (before : α → α → Bool) (item : α)
    (items : List α) (count : Nat) :
    (insert before item (items.take count)).take count = (insert before item items).take count := by
  induction items generalizing count with
  | nil => simp
  | cons head tail ih =>
    cases count with
    | zero => rfl
    | succ count =>
      by_cases precedes : before item head
      · have small (l : List α) : (l.take (count + 1)).take count = l.take count := by
          rw [List.take_take, Nat.min_eq_left (by omega)]
        simpa [insert, precedes] using congrArg (item :: ·) (small (head :: tail))
      · simp [insert, precedes, ih]

theorem fold_refinement (before : α → α → Bool) (keep : Nat) (inputs init : List α) :
    inputs.foldl (fun acc item => (insert before item acc).take keep) (init.take keep) =
      (inputs.foldl (fun acc item => insert before item acc) init).take keep := by
  induction inputs generalizing init with
  | nil => rfl
  | cons item rest ih =>
    simp only [List.foldl_cons]
    rw [first_keys_ignore_cut_tail, ih]

theorem bounded_is_full_sort_prefix (before : α → α → Bool) (keep : Nat) (users : List α) :
    bounded before keep users = (full before users).take keep := by
  simpa [bounded, full] using fold_refinement before keep users []

theorem bounded_selection_preserves_page (before : α → α → Bool)
    (users : List α) (offset limit : Nat) :
    ((bounded before (offset + limit) users).drop offset).take limit =
      ((full before users).drop offset).take limit := by
  rw [bounded_is_full_sort_prefix, List.drop_take]
  simp [List.take_take]

theorem zero_limit_returns_no_users (field : Field) (direction : Bool)
    (filters : List Predicate) (offset : Nat) (users : List User) :
    page field direction filters offset 0 users = [] := by
  simp [page]

end AuthUserPagination
