import ExportMetadata.Spec

namespace EM

theorem relative_has_no_absolute_prefix_or_parent (path : String) :
    relative path = true ↔ path.startsWith "/" = false ∧ (path.splitOn "/").contains ".." = false := by
  simp [relative]

theorem validated_directory_is_nonempty_and_relative (text path : String)
    (success : directory text = some path) :
    path.isEmpty = false ∧ relative path = true := by
  unfold directory at success
  split at success
  · rename_i valid
    cases success
    have con : (!text.isEmpty) = true ∧ relative text = true := by
      simpa only [Bool.and_eq_true] using valid
    have nonempty : text.isEmpty = false := by
      cases h : text.isEmpty <;> simp_all
    exact ⟨nonempty, con.2⟩
  · contradiction

theorem joined_tokens_drop_empty (text : String) (token : String)
    (member : token ∈ joinedTokens text) : token.isEmpty = false := by
  have keep := (List.mem_filter.mp member).2
  simpa using keep

theorem missing_manifest_version_precedes_every_section (fields : List (String × Wire))
    (absent : (Wire.object fields).text "version" = none) :
    (match manifest (.object fields) with
      | .error s => s = "the export manifest has no string \"version\""
      | .ok _ => False) := by
  simp only [manifest, required, absent]
  rfl

theorem wide_sizes_serialize_to_zero (size : Nat) (wide : 2 ^ 63 ≤ size) :
    writtenSize size = 0 := by
  simp [writtenSize, Nat.not_lt.mpr wide]

end EM
