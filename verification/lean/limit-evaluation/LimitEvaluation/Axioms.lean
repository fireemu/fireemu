import LimitEvaluation.Theorems

/-! Build-time checks for the permitted Lean axioms. -/

/-- info: 'LimitEvaluation.ratio_saturates' depends on axioms: [propext] -/
#guard_msgs in #print axioms LimitEvaluation.ratio_saturates

/-- info: 'LimitEvaluation.threshold_monotone' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms LimitEvaluation.threshold_monotone

/-- info: 'LimitEvaluation.no_maximum_allows' does not depend on any axioms -/
#guard_msgs in #print axioms LimitEvaluation.no_maximum_allows

/-- info: 'LimitEvaluation.observed_violation_does_not_reject' depends on axioms: [propext] -/
#guard_msgs in #print axioms LimitEvaluation.observed_violation_does_not_reject

/-- info: 'LimitEvaluation.violation_precedes_warning' depends on axioms: [propext] -/
#guard_msgs in #print axioms LimitEvaluation.violation_precedes_warning

/-- info: 'LimitEvaluation.exclusive_maximum_rejects_at_equality' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms LimitEvaluation.exclusive_maximum_rejects_at_equality

/-- info: 'LimitEvaluation.zero_has_no_approach_zone' does not depend on any axioms -/
#guard_msgs in #print axioms LimitEvaluation.zero_has_no_approach_zone

/-- info: 'LimitEvaluation.truncating_is_never_refusal' depends on axioms: [propext] -/
#guard_msgs in #print axioms LimitEvaluation.truncating_is_never_refusal

/-- info: 'LimitEvaluation.matching_override_wins' depends on axioms: [propext] -/
#guard_msgs in #print axioms LimitEvaluation.matching_override_wins
