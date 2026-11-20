import FirestoreTransforms.Spec

namespace FirestoreTransforms

theorem increment_in_bounds (a b : Int) :
    minI64 ≤ increment a b ∧ increment a b ≤ maxI64 := by
  have signedRange : minI64 ≤ maxI64 := by decide
  exact ⟨Int.le_max_left _ _, Int.max_le.mpr ⟨signedRange, Int.min_le_left _ _⟩⟩

theorem increment_exact_when_representable (a b : Int)
    (h : minI64 ≤ a + b ∧ a + b ≤ maxI64) :
    increment a b = a + b := by
  simp [increment, Int.min_eq_right h.2, Int.max_eq_right h.1]

theorem increment_clamps_upper (a b : Int) (h : maxI64 ≤ a + b) :
    increment a b = maxI64 := by
  have signedRange : minI64 ≤ maxI64 := by decide
  simp [increment, Int.min_eq_left h, Int.max_eq_right signedRange]

theorem increment_clamps_lower (a b : Int) (h : a + b ≤ minI64) :
    increment a b = minI64 := by
  have signedRange : minI64 ≤ maxI64 := by decide
  simp [increment, Int.min_eq_right (Int.le_trans h signedRange), Int.max_eq_left h]

theorem numeric_tie_preserves_current (maximum : Bool) (current operand : Scalar)
    (numeric : current.numeric = true) (currentFinite : current.isNan = false)
    (operandFinite : operand.isNan = false)
    (same : canonicalKey current = canonicalKey operand) :
    extremum maximum current operand = current := by
  simp [extremum, numeric, currentFinite, operandFinite, same]

theorem timestamp_truncation_preserves_canonical_key (value : Scalar) :
    canonicalKey (normalized value) = canonicalKey value := by
  cases value <;> simp [normalized, canonicalKey]

theorem union_keeps_prefix (current incoming : List Scalar) :
    ∃ suffix, appendMissing current incoming = current ++ suffix := by
  induction incoming generalizing current with
  | nil => exact ⟨[], by simp [appendMissing]⟩
  | cons item rest ih =>
    by_cases found : contains current item = true
    · simpa [appendMissing, found] using ih current
    · obtain ⟨suffix, kept⟩ := ih (current ++ [normalized item])
      exact ⟨normalized item :: suffix, by
        simp [appendMissing, found, kept, List.append_assoc]⟩

theorem removal_contains_exactly_unmatched (current operands : List Scalar) (value : Scalar) :
    value ∈ removeAll current operands ↔ value ∈ current ∧ contains operands value = false := by
  simp [removeAll]

end FirestoreTransforms
