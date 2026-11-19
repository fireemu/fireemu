import DocumentSize.Spec

namespace DS

theorem checked_add_exact (a b : Nat) :
    addSizes (checked a) (checked b) = checked (a + b) := by
  by_cases ha : a ≤ maxU64 <;> by_cases hb : b ≤ maxU64
  · simp [checked, ha, hb, addSizes, add]
  all_goals
    have h : ¬ a + b ≤ maxU64 := by omega
    simp [checked, ha, hb, h, addSizes]

theorem add_overflow_iff (a b : Nat) : add a b = none ↔ maxU64 < a + b := by
  simp [add, checked]

theorem string_size_exact (s : String) : stringSize s = checked (s.utf8ByteSize + 1) := by
  exact checked_add_exact s.utf8ByteSize 1

theorem segment_size_exact : ∀ path, segmentSize path = checked (segmentBytes path)
  | [] => rfl
  | s :: ss => by
    rw [segmentSize, segment_size_exact ss, string_size_exact]
    exact checked_add_exact (stringBytes s) (segmentBytes ss)

theorem document_name_size_exact (path : Path) :
    documentNameSize path = checked (16 + segmentBytes path) := by
  rw [documentNameSize, segment_size_exact]
  exact checked_add_exact 16 (segmentBytes path)

theorem reference_size_exact (s : String) :
    referenceSize s = checked (16 + segmentBytes (referencePath s)) :=
  document_name_size_exact (referencePath s)

mutual
theorem field_value_size_exact : ∀ v, fieldValueSize v = checked (valueBytes v)
  | .null | .boolean _ | .integer | .double | .timestamp | .geoPoint | .bytes _ => rfl
  | .string s => string_size_exact s
  | .reference s => reference_size_exact s
  | .array vs => array_size_exact vs
  | .vector n => by
    by_cases h : n ≤ maxU64
    · simp [fieldValueSize, valueBytes, checked, h] <;> rfl
    · have h' : ¬ n * 8 ≤ maxU64 := by omega
      simp [fieldValueSize, valueBytes, checked, h, h']
  | .map fs => fields_size_exact fs

theorem array_size_exact : ∀ vs, arraySize vs = checked (arrayBytes vs)
  | [] => rfl
  | v :: vs => by
    rw [arraySize, field_value_size_exact v, array_size_exact vs, arrayBytes, checked_add_exact]

theorem fields_size_exact : ∀ fs, fieldsSize fs = checked (fieldsBytes fs)
  | [] => rfl
  | (k, v) :: fs => by
    rw [fieldsSize, string_size_exact, field_value_size_exact v, fields_size_exact fs,
      fieldsBytes, checked_add_exact, checked_add_exact]
    rfl
end

theorem document_size_exact (path : Path) (fields : Fields) :
    documentSize path fields = (checked (documentBytes path fields)).map
      (fun n => { total := n, nameBytes := 16 + segmentBytes path, largestContributors := largestContributors fields }) := by
  rw [documentSize, document_name_size_exact, fields_size_exact, documentBytes]
  by_cases h : 16 + segmentBytes path ≤ maxU64
  · rw [show checked (16 + segmentBytes path) = some (16 + segmentBytes path) from by simp [checked, h]]
    change (addSizes (add (16 + segmentBytes path) 32) (checked (fieldsBytes fields))).bind
      (fun n => some ({ total := n, nameBytes := 16 + segmentBytes path, largestContributors := largestContributors fields } : Breakdown)) = _
    rw [add, checked_add_exact]
    cases checked (16 + segmentBytes path + 32 + fieldsBytes fields) <;> rfl
  · have h' : ¬ 16 + segmentBytes path + 32 + fieldsBytes fields ≤ maxU64 := by omega
    simp [checked, h, h']

theorem indexed_value_size_exact (v : Value) :
    indexedValueSize v = (checked (valueBytes v)).map (indexedCharge v) := by
  rw [indexedValueSize, field_value_size_exact]

theorem indexed_value_size_within_bound (v : Value) (h : valueBytes v ≤ maxU64) :
    indexedValueSize v = checked (indexedCharge v (valueBytes v)) := by
  have hc : indexedCharge v (valueBytes v) ≤ valueBytes v := by cases v <;> simp [indexedCharge, Nat.min_le_left]
  simp [indexed_value_size_exact, checked, h, Nat.le_trans hc h]

theorem indexed_fields_size_within_bound (fields : Fields)
    (h : ∀ e ∈ fields, valueBytes e.2 ≤ maxU64) :
    indexedFieldsSize fields = checked (indexedFieldsBytes fields) := by
  induction fields with
  | nil => rfl
  | cons e fs ih =>
    rw [indexedFieldsSize, indexed_value_size_within_bound _ (h e (by simp)),
      ih (fun e he => h e (by simp [he])), checked_add_exact]
    rfl

theorem index_entry_size_within_bound (scope : Scope) (path : Path) (parent : Option Path)
    (fields : Fields) (hd : 16 + segmentBytes path ≤ maxU64) (hp : parentBytes parent ≤ maxU64)
    (hf : ∀ e ∈ indexFields scope fields, valueBytes e.2 ≤ maxU64) :
    indexEntrySize scope path parent fields = (indexEntryBytes scope path parent fields).bind checked := by
  have hn : checked (16 + segmentBytes path) = some (16 + segmentBytes path) := by simp [checked, hd]
  have hparent : parentNameSize parent = some (parentBytes parent) := by
    cases parent with
    | none => rfl
    | some p => simpa [parentNameSize, parentBytes, document_name_size_exact, checked] using hp
  have hc : ∀ k, stringSize k = checked (stringBytes k) := string_size_exact
  have h32 : checked 32 = some 32 := rfl
  have h48 : checked 48 = some 48 := rfl
  rw [indexEntrySize, document_name_size_exact, hn, hparent]
  cases scope with
  | singleCollection | singleGroup =>
    cases fields with
    | nil => rfl
    | cons e fs =>
      have hv := hf e (by simp [indexFields])
      simp only [indexEntryBytes, List.head?_cons, Option.map_some, bind, Option.bind, hc, add]
      rw [indexed_value_size_within_bound _ hv]
      simp only [← hn, ← h32, ← h48, checked_add_exact]
  | compositeCollection | compositeGroup =>
    have hv := indexed_fields_size_within_bound fields hf
    simp only [indexEntryBytes, hv, bind, Option.bind, add]
    simp only [← hn, ← h32, checked_add_exact]

theorem index_entry_overflow_iff (scope : Scope) (path : Path) (parent : Option Path)
    (fields : Fields) (hd : 16 + segmentBytes path ≤ maxU64) (hp : parentBytes parent ≤ maxU64)
    (hf : ∀ e ∈ indexFields scope fields, valueBytes e.2 ≤ maxU64) :
    indexEntrySize scope path parent fields = none ↔
      indexEntryBytes scope path parent fields = none ∨
        ∃ n, indexEntryBytes scope path parent fields = some n ∧ maxU64 < n := by
  rw [index_entry_size_within_bound scope path parent fields hd hp hf]
  cases indexEntryBytes scope path parent fields <;> simp [checked]

theorem array_bytes_append (xs ys : List Value) :
    arrayBytes (xs ++ ys) = arrayBytes xs + arrayBytes ys := by
  induction xs with
  | nil => simp [arrayBytes]
  | cons x xs ih => simp [arrayBytes, ih, Nat.add_assoc]

theorem fields_bytes_append (xs ys : Fields) :
    fieldsBytes (xs ++ ys) = fieldsBytes xs + fieldsBytes ys := by
  induction xs with
  | nil => simp [fieldsBytes]
  | cons x xs ih => simp [fieldsBytes, ih, Nat.add_assoc]

theorem fields_bytes_perm {xs ys : Fields} (h : xs.Perm ys) :
    fieldsBytes xs = fieldsBytes ys := by
  induction h with
  | nil => rfl
  | cons x _ ih => simp [fieldsBytes, ih]
  | swap x y xs => simp [fieldsBytes, Nat.add_comm, Nat.add_left_comm]
  | trans _ _ h₁ h₂ => exact h₁.trans h₂

theorem array_concat_size (xs ys : List Value) :
    fieldValueSize (.array (xs ++ ys)) =
      addSizes (fieldValueSize (.array xs)) (fieldValueSize (.array ys)) := by
  simp only [field_value_size_exact, valueBytes, array_bytes_append, checked_add_exact]

/-- A union of disjoint maps has exactly the entries of both maps, possibly in a different order. -/
theorem disjoint_map_union_size {xs ys union : Fields} (h : union.Perm (xs ++ ys)) :
    fieldValueSize (.map union) = addSizes (fieldValueSize (.map xs)) (fieldValueSize (.map ys)) := by
  simp only [field_value_size_exact, valueBytes, fields_bytes_perm h, fields_bytes_append, checked_add_exact]

theorem array_size_monotone (xs ys : List Value) (h : arrayBytes (xs ++ ys) ≤ maxU64) :
    ∃ a b, fieldValueSize (.array xs) = some a ∧
      fieldValueSize (.array (xs ++ ys)) = some b ∧ a ≤ b := by
  simp only [array_bytes_append] at h
  have hx : arrayBytes xs ≤ maxU64 := by omega
  exact ⟨arrayBytes xs, arrayBytes xs + arrayBytes ys,
    by simp [field_value_size_exact, valueBytes, checked, hx],
    by simp [field_value_size_exact, valueBytes, array_bytes_append, checked, h],
    by omega⟩

theorem map_size_monotone {xs ys union : Fields} (hu : union.Perm (xs ++ ys))
    (h : fieldsBytes union ≤ maxU64) :
    ∃ a b, fieldValueSize (.map xs) = some a ∧
      fieldValueSize (.map union) = some b ∧ a ≤ b := by
  have hu' := (fields_bytes_perm hu).trans (fields_bytes_append xs ys)
  have hx : fieldsBytes xs ≤ maxU64 := by omega
  exact ⟨fieldsBytes xs, fieldsBytes union,
    by simp [field_value_size_exact, valueBytes, checked, hx],
    by simp [field_value_size_exact, valueBytes, checked, h],
    by omega⟩

theorem document_size_monotone (path : Path) {xs ys union : Fields}
    (hu : union.Perm (xs ++ ys)) (h : documentBytes path union ≤ maxU64) :
    ∃ a b : Breakdown, documentSize path xs = some a ∧
      documentSize path union = some b ∧ a.total ≤ b.total := by
  have hu' := (fields_bytes_perm hu).trans (fields_bytes_append xs ys)
  have hd : documentBytes path xs ≤ documentBytes path union := by
    simp only [documentBytes, hu']
    omega
  have hx := Nat.le_trans hd h
  exact ⟨{ total := documentBytes path xs, nameBytes := 16 + segmentBytes path, largestContributors := largestContributors xs },
    { total := documentBytes path union, nameBytes := 16 + segmentBytes path, largestContributors := largestContributors union },
    by simp [document_size_exact, checked, hx],
    by simp [document_size_exact, checked, h], hd⟩

theorem value_overflow_iff (v : Value) :
    fieldValueSize v = none ↔ maxU64 < valueBytes v := by
  simp [field_value_size_exact, checked]

theorem document_overflow_iff (path : Path) (fields : Fields) :
    documentSize path fields = none ↔ maxU64 < documentBytes path fields := by
  simp [document_size_exact, checked]

/-! ## Counterexamples and boundary behaviour -/

theorem array_append_can_overflow :
    fieldValueSize (.array [.bytes maxU64]) = some maxU64 ∧
    fieldValueSize (.array [.bytes maxU64, .null]) = none := by decide

theorem overlapping_map_union_can_shrink :
    fieldValueSize (.map [("k", .geoPoint)]) = some 18 ∧
    fieldValueSize (.map [("k", .null)]) = some 3 := by decide

theorem indexed_cap_does_not_hide_overflow :
    indexedValueSize (.vector (maxU64 / 8 + 1)) = none := by decide

theorem empty_single_field_index_refuses :
    indexEntrySize .singleCollection ["c", "d"] none [] = none ∧
    indexEntrySize .singleGroup ["c", "d"] none [] = none := by decide

theorem document_size_accepts_above_one_mib :
    (documentSize ["c", "d"] [("b", .bytes 1048523)]).map Breakdown.total = some 1048577 := by decide

theorem reference_strips_namespace_in_order :
    referencePath "projects/documents/databases/documents/documents/c/0001" = ["c", "0001"] := by decide

theorem reference_fallback_keeps_empty_segments :
    referenceSize "a//b/" = some 22 := by decide

theorem single_field_index_ignores_extra_fields :
    indexEntrySize .singleCollection ["c", "d"] none
      [("a", .null), ("b", .bytes (maxU64 + 1))] = some 55 := by decide

end DS
