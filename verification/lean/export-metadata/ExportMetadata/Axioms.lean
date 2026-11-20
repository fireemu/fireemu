import ExportMetadata.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'EM.relative_has_no_absolute_prefix_or_parent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EM.relative_has_no_absolute_prefix_or_parent

/-- info: 'EM.validated_directory_is_nonempty_and_relative' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EM.validated_directory_is_nonempty_and_relative

/-- info: 'EM.joined_tokens_drop_empty' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EM.joined_tokens_drop_empty

/-- info: 'EM.missing_manifest_version_precedes_every_section' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EM.missing_manifest_version_precedes_every_section

/-- info: 'EM.wide_sizes_serialize_to_zero' depends on axioms: [propext] -/
#guard_msgs in #print axioms EM.wide_sizes_serialize_to_zero
