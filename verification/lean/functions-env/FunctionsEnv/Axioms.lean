import FunctionsEnv.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'FunctionsEnv.exact_runtime_key_rejected' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEnv.exact_runtime_key_rejected

/-- info: 'FunctionsEnv.invalid_shape_precedes_prefix' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEnv.invalid_shape_precedes_prefix

/-- info: 'FunctionsEnv.accepted_key_has_valid_shape' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEnv.accepted_key_has_valid_shape

/-- info: 'FunctionsEnv.local_file_last' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsEnv.local_file_last

/-- info: 'FunctionsEnv.appended_assignment_wins' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEnv.appended_assignment_wins

/-- info: 'FunctionsEnv.single_quote_preserves_body' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEnv.single_quote_preserves_body
