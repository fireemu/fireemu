import CoreJson.Spec

namespace CoreJson

theorem advancing_measures_utf8 (cursor : Cursor) (n : Nat) :
    (cursor.advance n).byte = cursor.byte + ((cursor.left.take n).map Char.utf8Size).sum :=
  rfl

theorem combined_surrogate_is_supplementary {hi lo : Nat}
    (hhi : 0xd800 ≤ hi ∧ hi < 0xdc00) (hlo : 0xdc00 ≤ lo ∧ lo < 0xe000) :
    0x10000 ≤ combine hi lo ∧ combine hi lo ≤ 0x10ffff := by
  unfold combine
  omega

theorem lookup_after_put (members : List (String × Value)) (key : String) (v : Value) :
    lookup key (put key v members) = some v := by
  simp [lookup, put]

theorem replacing_key_preserves_other_lookup (members : List (String × Value))
    (key other : String) (v : Value) (distinct : key ≠ other) :
    lookup other (put key v members) = lookup other members := by
  have otherFirst : (key == other) = false := by simpa using distinct
  have predicates :
      (fun (entry : String × Value) => decide ((entry.1 != key) = true ∧ (entry.1 == other) = true)) =
      (fun entry => entry.1 == other) := by
    funext entry
    by_cases h : entry.1 = other
    · simp [h, Ne.symm distinct]
    · simp [h]
  simp only [lookup, put, List.find?_cons, otherFirst,
    List.find?_filter, predicates]

/-- Reading a run of plain scalars keeps the same byte cursor and accumulated output
as appending the complete run before processing its first delimiter. -/
theorem literal_run_fusion (run rest : List Char) (fuel byte : Nat) (rev : List Char)
    (literal : ∀ c ∈ run, c ≠ '"' ∧ c ≠ '\\' ∧ 32 ≤ c.toNat) :
    stringTail (fuel + run.length) ⟨run ++ rest, byte⟩ rev =
      stringTail fuel ⟨rest, byte + (run.map Char.utf8Size).sum⟩ (run.reverse ++ rev) := by
  induction run generalizing byte rev with
  | nil => simp
  | cons c run ih =>
    obtain ⟨quote, slash, valid⟩ := literal c (by simp)
    have remaining : ∀ item ∈ run, item ≠ '"' ∧ item ≠ '\\' ∧ 32 ≤ item.toNat := by
      intro item belongs
      exact literal item (by simp [belongs])
    simp only [List.length_cons, List.cons_append, List.map_cons, List.sum_cons]
    rw [← Nat.add_assoc fuel run.length 1]
    simp [stringTail, Cursor.head, Cursor.advance, Nat.not_lt_of_ge valid]
    simpa [Nat.add_assoc] using ih (byte + c.utf8Size) (c :: rev) remaining

theorem deep_values_fail_before_dispatch (fuel : Nat) (d : Nat) (cursor : Cursor)
    (tooDeep : d > depthLimit) :
    (match value (fuel + 1) d cursor with
      | .error e => e.byte = cursor.byte ∧ e.expected = "nesting within the depth budget"
      | .ok _ => False) := by
  simp [value, tooDeep, Cursor.failure]

end CoreJson
