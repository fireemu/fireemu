import CoreJson.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'CoreJson.advancing_measures_utf8' does not depend on any axioms -/
#guard_msgs in #print axioms CoreJson.advancing_measures_utf8

/-- info: 'CoreJson.combined_surrogate_is_supplementary' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CoreJson.combined_surrogate_is_supplementary

/-- info: 'CoreJson.lookup_after_put' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CoreJson.lookup_after_put

/-- info: 'CoreJson.replacing_key_preserves_other_lookup' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CoreJson.replacing_key_preserves_other_lookup

/-- info: 'CoreJson.deep_values_fail_before_dispatch' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CoreJson.deep_values_fail_before_dispatch

/-- info: 'CoreJson.literal_run_fusion' depends on axioms: [propext] -/
#guard_msgs in #print axioms CoreJson.literal_run_fusion
