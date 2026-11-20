import AuthCustomClaims.Spec

namespace AuthCustomClaims

theorem original_source_is_reported (members : Entries) (original : String) :
    presentation ⟨members, some original⟩ = some original := rfl

theorem source_is_charged (members : Entries) (original : String) :
    storedBytes ⟨members, some original⟩ = original.utf8ByteSize := rfl

theorem absent_mutation_does_not_clear_source (state : ClaimState) (key : String)
    (missing : state.entries.any (fun member => member.1 == key) = false) :
    remove state key = state := by simp [remove, missing]

theorem removal_clears_source (state : ClaimState) (key : String)
    (present : state.entries.any (fun member => member.1 == key) = true) :
    (remove state key).source = none := by simp [remove, present]

theorem replacement_charges_canonical (state : ClaimState) (key encoded : String) :
    storedBytes (replace state key encoded) =
      (canonical (replace state key encoded).entries).utf8ByteSize := rfl

theorem never_configured_empty_is_absent :
    presentation ⟨[], none⟩ = none := rfl

theorem limit_is_inclusive (state : ClaimState) :
    fits state = true ↔ storedBytes state ≤ 1000 := by simp [fits]

end AuthCustomClaims
