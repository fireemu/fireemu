import StorageListPages.Spec

namespace StorageListPages

theorem unique_has_no_duplicates [DecidableEq α] (xs : List α) : (unique xs).Nodup := by
  induction xs with
  | nil => simp [unique]
  | cons x xs ih =>
    apply List.nodup_cons.mpr
    refine ⟨?_, ih.sublist List.filter_sublist⟩
    simp

theorem ordered_has_no_duplicate_keys (snapshot : List Version) (mode : Mode) (search delimiter : String) :
    (ordered snapshot mode search delimiter).Nodup :=
  unique_has_no_duplicates _

theorem cut_is_partition (limit : Nat) (keys : List α) :
    (cut limit keys).1 ++ (cut limit keys).2 = keys :=
  List.take_append_drop limit keys

theorem pages_have_no_loss (limit fuel : Nat) (keys : List α)
    (positive : 0 < limit) (bound : keys.length ≤ fuel) :
    (pageSequence limit fuel keys).flatten = keys := by
  induction fuel generalizing keys with
  | zero =>
    have empty : keys = [] := List.length_eq_zero_iff.mp (by omega)
    simp [pageSequence, empty]
  | succ fuel ih =>
    cases keys with
    | nil => simp [pageSequence]
    | cons key keys =>
      have shorter : ((key :: keys).drop limit).length ≤ fuel := by
        simp only [List.length_cons] at bound
        simp only [List.length_drop, List.length_cons]
        omega
      simp only [pageSequence, cut, List.flatten_cons]
      rw [ih ((key :: keys).drop limit) shorter]
      exact List.take_append_drop limit (key :: keys)

theorem stable_pages_have_no_duplicate_keys (snapshot : List Version) (mode : Mode)
    (search delimiter : String) (limit fuel : Nat) (positive : 0 < limit)
    (bound : (ordered snapshot mode search delimiter).length ≤ fuel) :
    (pageSequence limit fuel (ordered snapshot mode search delimiter)).flatten.Nodup := by
  rw [pages_have_no_loss limit fuel _ positive bound]
  exact ordered_has_no_duplicate_keys snapshot mode search delimiter

/-- A valid boundary marker discards precisely the emitted region of a fixed ordered list. -/
theorem marker_preserves_remaining (emitted remaining : List α) (keep : α → Bool)
    (oldKeys : ∀ x ∈ emitted, ¬keep x) (newKeys : ∀ x ∈ remaining, keep x) :
    (emitted ++ remaining).filter keep = remaining := by
  rw [List.filter_append, List.filter_eq_nil_iff.mpr oldKeys,
    List.filter_eq_self.mpr newKeys, List.nil_append]

theorem firebase_marker_uses_last_returned (first more : Key) (page rest : List Key) :
    nextKey .firebase (first :: page) (more :: rest) = (first :: page).getLast? := by
  simp [nextKey]

theorem gcs_marker_uses_first_remaining (more : Key) (page rest : List Key) :
    nextKey .gcs page (more :: rest) = some more := by
  simp [nextKey]

end StorageListPages
