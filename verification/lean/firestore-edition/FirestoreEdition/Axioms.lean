import FirestoreEdition.Theorems

/-! Guard that the specification proofs use only Lean's standard axioms. -/

/-- info: 'FE.standard_mongo_refused_first' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FE.standard_mongo_refused_first

/-- info: 'FE.admitted_pipeline' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FE.admitted_pipeline

/-- info: 'FE.admitted_core' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FE.admitted_core

/-- info: 'FE.search_status_agrees' does not depend on any axioms -/
#guard_msgs in #print axioms FE.search_status_agrees
