import RulesFailureAlgebra.Spec

/-! Guard the standard Lean axiom dependencies of the model theorems. -/

/-- info: 'RulesFailureAlgebra.absorber_ignores_suffix' does not depend on any axioms -/
#guard_msgs in #print axioms RulesFailureAlgebra.absorber_ignores_suffix

/-- info: 'RulesFailureAlgebra.missing_is_absorbed_but_observed' does not depend on any axioms -/
#guard_msgs in #print axioms RulesFailureAlgebra.missing_is_absorbed_but_observed

/-- info: 'RulesFailureAlgebra.unsupported_precedes_later_absorber' does not depend on any axioms -/
#guard_msgs in #print axioms RulesFailureAlgebra.unsupported_precedes_later_absorber

/-- info: 'RulesFailureAlgebra.neutral_only' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesFailureAlgebra.neutral_only

/-- info: 'RulesFailureAlgebra.recoverable_prefix' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesFailureAlgebra.recoverable_prefix
