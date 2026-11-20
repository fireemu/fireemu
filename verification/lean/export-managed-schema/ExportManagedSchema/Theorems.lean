import ExportManagedSchema.Spec

namespace ManagedSchema

theorem already_seen_keeps_order [DecidableEq α] (seen : List α) (item : α)
    (present : item ∈ seen) : remember seen item = seen := by
  simp [remember, present]

theorem first_sighting_appends [DecidableEq α] (seen : List α) (item : α)
    (absent : item ∉ seen) : remember seen item = seen ++ [item] := by
  simp [remember, absent]

theorem accumulation_keeps_prefix [DecidableEq α] (seen pending : List α) :
    ∃ suffix, pending.foldl remember seen = seen ++ suffix := by
  induction pending generalizing seen with
  | nil => exact ⟨[], by simp⟩
  | cons item rest ih =>
    rcases ih (remember seen item) with ⟨suffix, equation⟩
    by_cases h : item ∈ seen
    · exact ⟨suffix, by simpa [remember, h] using equation⟩
    · exact ⟨item :: suffix, by simpa [remember, h, List.append_assoc] using equation⟩

theorem first_seen_names_are_a_prefix (first later : List Observation) :
    ∃ suffix, (infer (first ++ later)).map Observation.name =
      (infer first).map Observation.name ++ suffix := by
  simpa [infer, distinct, List.map_map, Function.comp_def, List.foldl_append] using
    accumulation_keeps_prefix ((first.map Observation.name).foldl remember [])
      (later.map Observation.name)

theorem distinct_types_are_a_prefix (name : String) (first later : List Observation) :
    ∃ suffix, distinct (codesOf name (first ++ later)) = distinct (codesOf name first) ++ suffix := by
  simpa [codesOf, distinct, List.foldl_append] using
    accumulation_keeps_prefix ((codesOf name first).foldl remember []) (codesOf name later)

theorem repeated_is_monotone (name : String) (first later : List Observation)
    (h : isRepeated name first = true) : isRepeated name (first ++ later) = true := by
  simp [isRepeated, List.any_append, isRepeated] at h ⊢
  exact Or.inl h

end ManagedSchema
