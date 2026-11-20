import ExportLevelDb.Spec

namespace ExportLevelDb

theorem chunk_sum (fuel size : Nat) : (chunks fuel size).sum = size := by
  induction fuel generalizing size with
  | zero => simp [chunks]
  | succ fuel ih =>
    simp only [chunks]
    split
    · simp
    · simp only [List.sum_cons, ih]
      omega

theorem chunks_fit (fuel size : Nat) (h : size ≤ fuel) :
    ∀ n ∈ chunks fuel size, n ≤ capacity := by
  induction fuel generalizing size with
  | zero =>
    have : size = 0 := by omega
    simp [chunks, this]
  | succ fuel ih =>
    simp only [chunks]
    split
    · rename_i fits
      simp [fits]
    · rename_i larger
      intro n member
      rw [List.mem_cons] at member
      rcases member with eq | member
      · simp [eq]
      · have residue : size - capacity ≤ fuel := by
          have : 0 < capacity := by decide
          omega
        exact ih _ residue n member

theorem continuation_payload_sizes (ns : List Nat) :
    (continuation ns).map Piece.payload = ns := by
  fun_induction continuation <;> simp_all [Piece.payload]

theorem padding_occupies_only_short_trailer (off : Nat) :
    ∀ p ∈ paddingAt off, ∃ n, p = .padding n ∧ 0 < n ∧ n < headerSize := by
  have positive : 0 < room off := by
    have less := Nat.mod_lt off (by decide : 0 < blockSize)
    unfold room
    omega
  intro p member
  unfold paddingAt at member
  split at member
  · rename_i short
    simp only [List.mem_singleton] at member
    exact ⟨room off, member, positive, short⟩
  · simp at member

theorem first_capacity_bounded (off : Nat) : firstCapacity off ≤ capacity := by
  have : room off ≤ blockSize := by unfold room; omega
  unfold firstCapacity capacity
  split <;> omega

theorem layout_conserves_payload (off length : Nat) :
    ((layout off length).map Piece.payload).sum = length := by
  have trailer : ((paddingAt off).map Piece.payload).sum = 0 := by
    unfold paddingAt
    split <;> simp [Piece.payload]
  simp only [layout, List.map_append, List.sum_append, trailer, Nat.zero_add]
  split
  · simp [Piece.payload]
  · simp only [List.map_cons, Piece.payload, List.sum_cons, continuation_payload_sizes, chunk_sum]
    omega

theorem layouts_conserve_payload (off : Nat) (lengths : List Nat) :
    ((layouts off lengths).map Piece.payload).sum = lengths.sum := by
  induction lengths generalizing off with
  | nil => rfl
  | cons length lengths ih =>
    simp only [layouts, List.map_append, List.sum_append, layout_conserves_payload, ih, List.sum_cons]

theorem exact_header_can_emit_empty_first :
    layout (blockSize - headerSize) 1 = [.first 0, .last 1] := by decide

theorem short_tail_is_padded_before_the_next_header :
    layout (blockSize - 1) 1 = [.padding 1, .full 1] := by decide

end ExportLevelDb
