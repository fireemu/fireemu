import FirestorePartitionQuery.Spec

namespace FirestorePartitionQuery

theorem same_relative_path_hash (salt : String) (a b : Key)
    (h : relative a = relative b) : keyHash salt a = keyHash salt b := by
  simp [keyHash, h]

theorem sampled_is_namespace_independent (project database : String) (key : Key) :
    sampled { key with project := project, database := database } = sampled key := rfl

theorem cursor_count (keys : List Key) (requested : Nat) :
    (cursors keys requested).length = min requested (keys.filter sampled).length := by
  simp [cursors, priorities]

theorem cursor_membership_nests (keys : List Key) (small large : Nat) (h : small ≤ large)
    (key : Key) (kept : key ∈ cursors keys small) : key ∈ cursors keys large := by
  simp only [cursors, List.mem_mergeSort] at kept ⊢
  exact List.take_subset_take_left (priorities keys) h kept

theorem every_cursor_was_sampled (keys : List Key) (requested : Nat)
    (key : Key) (h : key ∈ cursors keys requested) :
    key ∈ keys ∧ sampled key = true := by
  have chosen : key ∈ (priorities keys).take requested := by simpa [cursors] using h
  have eligible := List.mem_of_mem_take chosen
  simpa [priorities] using eligible

end FirestorePartitionQuery
