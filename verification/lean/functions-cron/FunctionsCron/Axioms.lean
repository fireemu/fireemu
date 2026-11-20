import FunctionsCron.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'FunctionsCron.restricted_days_disjoin' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsCron.restricted_days_disjoin

/-- info: 'FunctionsCron.window_contains_only_eligible_runs' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsCron.window_contains_only_eligible_runs

/-- info: 'FunctionsCron.window_enumeration_respects_cap' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsCron.window_enumeration_respects_cap

/-- info: 'FunctionsCron.capped_is_exact_when_small' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsCron.capped_is_exact_when_small

/-- info: 'FunctionsCron.interval_count_is_exact' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsCron.interval_count_is_exact

/-- info: 'FunctionsCron.next_interval_strictly_after' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsCron.next_interval_strictly_after

/-- info: 'FunctionsCron.previous_interval_at_or_before' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsCron.previous_interval_at_or_before

/-- info: 'FunctionsCron.reported_count_is_lower_bound' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsCron.reported_count_is_lower_bound
