import RulesRegex.Theorems
import RulesRegex.Parser

/-! Changes to the standard axiom dependencies fail the default build. -/

/-- info: 'RR.nullable_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RR.nullable_iff

/-- info: 'RR.join_lang' depends on axioms: [propext] -/
#guard_msgs in #print axioms RR.join_lang

/-- info: 'RR.cat_lang' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RR.cat_lang

/-- info: 'RR.cat_cons' does not depend on any axioms -/
#guard_msgs in #print axioms RR.cat_cons

/-- info: 'RR.star_cons' does not depend on any axioms -/
#guard_msgs in #print axioms RR.star_cons

/-- info: 'RR.deriv_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RR.deriv_iff

/-- info: 'RR.matches_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RR.matches_iff

/-- info: 'RR.steps_eq_length' depends on axioms: [propext] -/
#guard_msgs in #print axioms RR.steps_eq_length

/-- info: 'RR.copies_lang' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RR.copies_lang

/-- info: 'RR.optional_lang' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RR.optional_lang

/-- info: 'RR.bounded_expansion' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RR.bounded_expansion

/-- info: 'RR.open_expansion' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RR.open_expansion

/-- info: 'RR.dot_singleton' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RR.dot_singleton

/-- info: 'RR.dot_refuses_lf' depends on axioms: [propext] -/
#guard_msgs in #print axioms RR.dot_refuses_lf

/-- info: 'RR.inverted_bounds_refused' depends on axioms: [propext] -/
#guard_msgs in #print axioms RR.inverted_bounds_refused

/-- info: 'RR.compile_of_guards' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RR.compile_of_guards

/-- info: 'RR.class_preflight_refusal' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RR.class_preflight_refusal
