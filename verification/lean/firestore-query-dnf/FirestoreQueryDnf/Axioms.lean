import FirestoreQueryDnf.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'FirestoreQueryDnf.product_branch_count' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreQueryDnf.product_branch_count

/-- info: 'FirestoreQueryDnf.product_occurrences' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreQueryDnf.product_occurrences

/-- info: 'FirestoreQueryDnf.statistics_spec' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryDnf.statistics_spec

/-- info: 'FirestoreQueryDnf.capped_add' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryDnf.capped_add

/-- info: 'FirestoreQueryDnf.capped_multiply' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryDnf.capped_multiply

/-- info: 'FirestoreQueryDnf.component_filters_within_limit' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryDnf.component_filters_within_limit

/-- info: 'FirestoreQueryDnf.component_filters_above_limit' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreQueryDnf.component_filters_above_limit

/-- info: 'FirestoreQueryDnf.product_associative' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryDnf.product_associative

/-- info: 'FirestoreQueryDnf.saturating_fold_counts' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreQueryDnf.saturating_fold_counts
