import ExportManagedSchema.Theorems

/-- info: 'ManagedSchema.already_seen_keeps_order' depends on axioms: [propext] -/
#guard_msgs in #print axioms ManagedSchema.already_seen_keeps_order

/-- info: 'ManagedSchema.first_sighting_appends' depends on axioms: [propext] -/
#guard_msgs in #print axioms ManagedSchema.first_sighting_appends

/-- info: 'ManagedSchema.accumulation_keeps_prefix' depends on axioms: [propext] -/
#guard_msgs in #print axioms ManagedSchema.accumulation_keeps_prefix

/-- info: 'ManagedSchema.first_seen_names_are_a_prefix' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ManagedSchema.first_seen_names_are_a_prefix

/-- info: 'ManagedSchema.distinct_types_are_a_prefix' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ManagedSchema.distinct_types_are_a_prefix

/-- info: 'ManagedSchema.repeated_is_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ManagedSchema.repeated_is_monotone
