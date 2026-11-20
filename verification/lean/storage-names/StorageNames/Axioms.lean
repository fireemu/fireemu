import StorageNames.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'StorageNames.first_violation_none_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.first_violation_none_iff

/-- info: 'StorageNames.object_accepted_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.object_accepted_iff

/-- info: 'StorageNames.strict_accepted_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.strict_accepted_iff

/-- info: 'StorageNames.object_length_precedes_other_checks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.object_length_precedes_other_checks

/-- info: 'StorageNames.strict_setup_checks_precede_grammar' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.strict_setup_checks_precede_grammar

/-- info: 'StorageNames.strict_rejects_disallowed_characters' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.strict_rejects_disallowed_characters

/-- info: 'StorageNames.strict_acceptance_refines_core_acceptance' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.strict_acceptance_refines_core_acceptance

/-- info: 'StorageNames.object_can_contain_slash_and_percent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.object_can_contain_slash_and_percent

/-- info: 'StorageNames.core_accepts_legacy_bucket' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.core_accepts_legacy_bucket

/-- info: 'StorageNames.strict_refuses_legacy_bucket' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms StorageNames.strict_refuses_legacy_bucket
