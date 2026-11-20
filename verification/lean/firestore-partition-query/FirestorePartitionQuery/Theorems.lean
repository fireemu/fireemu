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

private theorem bytesAppend (left right : String) :
    (left ++ right).toUTF8.data.toList = left.toUTF8.data.toList ++ right.toUTF8.data.toList := by
  change (left ++ right).toByteArray.data.toList =
    left.toByteArray.data.toList ++ right.toByteArray.data.toList
  rw [String.toByteArray_append, ByteArray.toList_data_append]

private theorem slashBytes : "/".toUTF8.data.toList = [47] := rfl

theorem hashRelativeAgrees (state : UInt64) (parts : List String) :
    hashRelative state parts = (String.intercalate "/" parts).toUTF8.data.toList.foldl fnvStep state := by
  induction parts generalizing state with
  | nil => rfl
  | cons part rest ih =>
    cases rest with
    | nil => simp [hashRelative]
    | cons next rest =>
      rw [hashRelative, ih, String.intercalate_cons_cons, bytesAppend, bytesAppend]
      simp only [List.foldl_append, slashBytes, List.foldl_cons, List.foldl_nil]

theorem streamingKeyHashAgrees (salt : String) (key : Key) :
    streamingKeyHash salt key = keyHash salt key := by
  rw [streamingKeyHash, hashRelativeAgrees]
  simp [keyHash, relative, fnv, List.foldl_append]

theorem mapAfterPagination (encode : α → β) (cursors : List α) (offset size : Nat) :
    ((cursors.drop offset).take size).map encode =
      ((cursors.map encode).drop offset).take size := by
  rw [List.map_take, List.map_drop]

end FirestorePartitionQuery
