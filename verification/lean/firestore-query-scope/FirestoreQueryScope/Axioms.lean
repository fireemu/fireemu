import FirestoreQueryScope.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'FirestoreQueryScope.remainder_of_suffix' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreQueryScope.remainder_of_suffix

/-- info: 'FirestoreQueryScope.remainder_gives_decomposition' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreQueryScope.remainder_gives_decomposition

/-- info: 'FirestoreQueryScope.excludes_anchor' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryScope.excludes_anchor

/-- info: 'FirestoreQueryScope.child_is_descendant' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryScope.child_is_descendant

/-- info: 'FirestoreQueryScope.named_is_kindless' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryScope.named_is_kindless

/-- info: 'FirestoreQueryScope.root_kindless_contains_every_document' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryScope.root_kindless_contains_every_document
