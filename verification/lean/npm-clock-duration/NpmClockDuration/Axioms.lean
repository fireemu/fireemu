import NpmClockDuration.Theorems

/-! Records the axioms of the exported reference theorems. -/

/-- info: 'NpmClockDuration.all_zero_parts_use_seconds' depends on axioms: [propext] -/
#guard_msgs in #print axioms NpmClockDuration.all_zero_parts_use_seconds

/-- info: 'NpmClockDuration.nonzero_units_keep_canonical_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms NpmClockDuration.nonzero_units_keep_canonical_order

/-- info: 'NpmClockDuration.legacy_object_passes_through' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms NpmClockDuration.legacy_object_passes_through

/-- info: 'NpmClockDuration.legacy_options_are_rejected' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms NpmClockDuration.legacy_options_are_rejected

/-- info: 'NpmClockDuration.millis_conflict_wins' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms NpmClockDuration.millis_conflict_wins

/-- info: 'NpmClockDuration.invalid_duration_precedes_options' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms NpmClockDuration.invalid_duration_precedes_options

/-- info: 'NpmClockDuration.anchor_checks_target_first' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms NpmClockDuration.anchor_checks_target_first

/-- info: 'NpmClockDuration.invalid_zone_precedes_backwards' depends on axioms: [propext] -/
#guard_msgs in #print axioms NpmClockDuration.invalid_zone_precedes_backwards

/-- info: 'NpmClockDuration.raw_duration_keeps_spelling' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms NpmClockDuration.raw_duration_keeps_spelling
