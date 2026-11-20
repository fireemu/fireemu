import CloudTasksRetry.Theorems

/-! Checks the axioms used by the exported correctness statements. -/

/-- info: 'CTRetry.within_limit' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTRetry.within_limit

/-- info: 'CTRetry.positive_budget_exhaustion' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CTRetry.positive_budget_exhaustion

/-- info: 'CTRetry.disabled_budget_equivalent' does not depend on any axioms -/
#guard_msgs in #print axioms CTRetry.disabled_budget_equivalent

/-- info: 'CTRetry.declared_cap' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTRetry.declared_cap

/-- info: 'CTRetry.production_never_shortens' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTRetry.production_never_shortens

/-- info: 'CTRetry.nonproduction_unchanged' does not depend on any axioms -/
#guard_msgs in #print axioms CTRetry.nonproduction_unchanged
