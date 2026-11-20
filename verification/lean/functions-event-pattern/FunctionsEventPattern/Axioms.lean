import FunctionsEventPattern.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'FunctionsEventPattern.terminal_multi_capture' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEventPattern.terminal_multi_capture

/-- info: 'FunctionsEventPattern.literal_consumes_one' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEventPattern.literal_consumes_one

/-- info: 'FunctionsEventPattern.accepted_fixed_pattern_length' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FunctionsEventPattern.accepted_fixed_pattern_length
