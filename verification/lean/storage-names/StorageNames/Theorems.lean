import StorageNames.Spec

namespace StorageNames

theorem first_violation_none_iff (rules : List (Bool × Violation)) :
    firstViolation rules = none ↔ ∀ r ∈ rules, r.1 = false := by
  induction rules with
  | nil => simp [firstViolation]
  | cons rule rules ih =>
    obtain ⟨bad, reason⟩ := rule
    cases bad <;> simp_all [firstViolation]

theorem object_accepted_iff (name : String) :
    objectViolation name = none ↔ ∀ rule ∈ objectRules name, rule.1 = false :=
  first_violation_none_iff (objectRules name)

theorem strict_accepted_iff (name : String) :
    strictViolation name = none ↔ ∀ rule ∈ strictRules name, rule.1 = false :=
  first_violation_none_iff (strictRules name)

theorem object_length_precedes_other_checks (name : String)
    (nonempty : name.isEmpty = false) (over : 1024 < name.utf8ByteSize) :
    objectViolation name = some .long := by
  simp [objectViolation, objectRules, firstViolation, nonempty, over]

theorem strict_setup_checks_precede_grammar (name : String) (small : name.utf8ByteSize < 3) :
    strictViolation name = some .strictShort := by
  simp [strictViolation, strictRules, firstViolation, small]

theorem strict_rejects_disallowed_characters (name : String)
    (accepted : strictViolation name = none) :
    ∀ c ∈ name.toList, bucketChar c = true := by
  have allRules := (strict_accepted_iff name).mp accepted
  have guard := allRules (!(name.toList.all bucketChar), .strictCharacter) (by simp [strictRules])
  exact List.all_eq_true.mp (by simpa using guard)

theorem strict_acceptance_refines_core_acceptance (name : String)
    (accepted : strictViolation name = none) : bucketViolation name = none := by
  have allRules := (strict_accepted_iff name).mp accepted
  have minChecked := allRules (decide (name.utf8ByteSize < 3), .strictShort) (by simp [strictRules])
  have maxChecked := allRules (decide (222 < name.utf8ByteSize), .strictLong) (by simp [strictRules])
  have notSmall : ¬name.utf8ByteSize < 3 := by simpa using minChecked
  have notLarge : ¬222 < name.utf8ByteSize := by simpa using maxChecked
  have nonempty : name.isEmpty = false := by
    cases empty : name.isEmpty with
    | false => rfl
    | true =>
      have zero := String.isEmpty_iff_utf8ByteSize_eq_zero.mp empty
      omega
  have alphabet := List.all_eq_true.mpr (strict_rejects_disallowed_characters name accepted)
  simp [bucketViolation, bucketRules, firstViolation, nonempty, notLarge, alphabet]

theorem object_can_contain_slash_and_percent : objectViolation "/a/%2F/../" = none := by decide
theorem core_accepts_legacy_bucket : bucketViolation "." = none := by decide
theorem strict_refuses_legacy_bucket : strictViolation "." = some .strictShort := by decide

end StorageNames
