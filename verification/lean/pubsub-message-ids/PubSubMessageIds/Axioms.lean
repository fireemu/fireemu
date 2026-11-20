import PubSubMessageIds.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'PMI.recover_residue' depends on axioms: [propext] -/
#guard_msgs in #print axioms PMI.recover_residue

/-- info: 'PMI.message_ids_equal_iff_residues' depends on axioms: [propext] -/
#guard_msgs in #print axioms PMI.message_ids_equal_iff_residues

/-- info: 'PMI.message_ids_are_17_digits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PMI.message_ids_are_17_digits

/-- info: 'PMI.broker_partition_is_injective' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms PMI.broker_partition_is_injective

/-- info: 'PMI.runtime_slots_in_upper_half' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PMI.runtime_slots_in_upper_half

/-- info: 'PMI.affine_slots_in_upper_half' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PMI.affine_slots_in_upper_half

/-- info: 'PMI.broker_and_runtime_disjoint' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PMI.broker_and_runtime_disjoint

/-- info: 'PMI.broker_and_seeded_runtime_disjoint' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PMI.broker_and_seeded_runtime_disjoint

/-- info: 'PMI.runtime_normalizes_zero' does not depend on any axioms -/
#guard_msgs in #print axioms PMI.runtime_normalizes_zero

/-- info: 'PMI.runtime_wraps' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms PMI.runtime_wraps

/-- info: 'PMI.seeded_runtime_wraps' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms PMI.seeded_runtime_wraps

/-- info: 'PMI.position_is_bounded' does not depend on any axioms -/
#guard_msgs in #print axioms PMI.position_is_bounded

/-- info: 'PMI.position_updates_compose' depends on axioms: [propext] -/
#guard_msgs in #print axioms PMI.position_updates_compose

/-- info: 'PMI.adjustment_removes_factor_five' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms PMI.adjustment_removes_factor_five

/-- info: 'PMI.adjustment_keeps_parity' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms PMI.adjustment_keeps_parity

/-- info: 'PMI.seeded_multiplier_is_coprime' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms PMI.seeded_multiplier_is_coprime

/-- info: 'PMI.seeded_ids_are_injective_under_half_span' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PMI.seeded_ids_are_injective_under_half_span
