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

theorem deep_values_fail_before_dispatch (fuel : Nat) (d : Nat) (cursor : Cursor)
    (tooDeep : d > depthLimit) :
    (match value (fuel + 1) d cursor with
      | .error e => e.byte = cursor.byte ∧ e.expected = "nesting within the depth budget"
      | .ok _ => False) := by
  simp [value, tooDeep, Cursor.failure]

end CoreJson
