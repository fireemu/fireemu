import FirestoreWatchBloom.Spec

namespace FirestoreWatchBloom

theorem positionWithinCapacity (h1 h2 index capacity : Nat) (positive : 0 < capacity) :
    position h1 h2 index capacity < capacity :=
  Nat.mod_lt _ positive

theorem paddingBeyondCapacity (layout : Layout) (h : layout.bytes * 8 ≤ layout.padding.toNat)
    (digest : Nat × Nat) : indices layout digest = [] := by
  simp [indices, bits, Nat.sub_eq_zero_of_le h]

theorem bitmapWidth (layout : Layout) (names : List (Nat × Nat)) :
    (bitmap layout names).length = layout.bytes := by
  simp [bitmap]

theorem insertionKeepsBit (layout : Layout) (names : List (Nat × Nat))
    (digest : Nat × Nat) (bit : Nat) (h : present layout names bit = true) :
    present layout (digest :: names) bit = true := by
  unfold present at h ⊢
  simp only [List.any_cons, h, Bool.or_true]

theorem duplicateInsertionKeepsBits (layout : Layout) (rest : List (Nat × Nat))
    (digest : Nat × Nat) (bit : Nat) :
    present layout (digest :: digest :: rest) bit = present layout (digest :: rest) bit := by
  simp [present]

theorem outOfRecordedRange (count : Nat) (h : 3 < count) : recorded count = none := by
  obtain ⟨n, rfl⟩ : ∃ n, count = n + 4 := ⟨count - 4, by omega⟩
  rfl

end FirestoreWatchBloom
