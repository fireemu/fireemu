import FunctionsFirestoreIndex.Spec

namespace FirestoreIndex

theorem bucket_selects_in_order (database : String) (functions : List Function) :
    bucket database functions = functions.filter (fun fn => sameDatabase fn database) := by
  induction functions with
  | nil => rfl
  | cons first rest ih =>
    change (if sameDatabase first database then first :: bucket database rest
      else bucket database rest) = _
    by_cases selected : sameDatabase first database
    · simp [selected, ih]
    · simp [selected, ih]

theorem dispatch_is_scan (event : Event) (functions : List Function) :
    query event functions = scan event functions := by
  unfold query
  rw [bucket_selects_in_order]
  induction functions with
  | nil => rfl
  | cons first rest ih =>
    by_cases selected : sameDatabase first event.database
    · cases matched : matchEvent event first <;>
        simp [scan, selected, matched] at ih ⊢ <;>
        rw [ih]
    · simp [scan, selected] at ih ⊢
      rw [ih]

theorem bucket_ignores_other_manifest_entries (db : String) (first : Function)
    (rest : List Function) (irrelevant : sameDatabase first db = false) :
    bucket db (first :: rest) = bucket db rest := by
  rw [bucket_selects_in_order, bucket_selects_in_order]
  simp [irrelevant]

end FirestoreIndex
