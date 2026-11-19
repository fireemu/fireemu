import FirestoreValueOrder.Concrete

/-!
Build-time guard: the theorems use only Lean's standard axioms. A `sorry` (or a new axiom)
changes the printed list and fails the build.
-/

/-- info: 'FVO.cmp_laws' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FVO.cmp_laws

/-- info: 'FVO.cmp_total' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FVO.cmp_total

/-- info: 'FVO.nan_eq_nan' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FVO.nan_eq_nan

/-- info: 'FVO.neg_zero_eq_zero' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FVO.neg_zero_eq_zero

/--
info: 'FVO.one_eq_one_point_zero' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms FVO.one_eq_one_point_zero

/-- info: 'FVO.nan_lt_neg_inf' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FVO.nan_lt_neg_inf
