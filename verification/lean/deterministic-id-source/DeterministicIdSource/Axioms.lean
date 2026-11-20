import DeterministicIdSource.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'DIS.mix_injective' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.mix_injective

/-- info: 'DIS.projected_append' depends on axioms: [propext] -/
#guard_msgs in #print axioms DIS.projected_append

/-- info: 'DIS.unrelated_calls_keep_next_id' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.unrelated_calls_keep_next_id

/-- info: 'DIS.command_ids_are_dense_before_wrap' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.command_ids_are_dense_before_wrap

/-- info: 'DIS.unrelated_append_keeps_counter' depends on axioms: [propext] -/
#guard_msgs in #print axioms DIS.unrelated_append_keeps_counter

/-- info: 'DIS.mixed_kinds_disjoint_at_fixed_session_and_seed' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.mixed_kinds_disjoint_at_fixed_session_and_seed

/-- info: 'DIS.mixed_counters_injective_before_wrap' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.mixed_counters_injective_before_wrap

/-- info: 'DIS.selected_draw_is_below_bound' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.selected_draw_is_below_bound

/-- info: 'DIS.draw_wraps_seed_space' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.draw_wraps_seed_space

/-- info: 'DIS.distinct_sessions_can_alias' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms DIS.distinct_sessions_can_alias
