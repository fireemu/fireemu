import FirestoreAggregates.Theorems

/-! Build-time guard for the permitted Lean axioms. -/

/-- info: 'FirestoreAggregates.integer_add_is_exact_within_bounds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreAggregates.integer_add_is_exact_within_bounds

/-- info: 'FirestoreAggregates.integer_add_promotes_on_overflow' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreAggregates.integer_add_promotes_on_overflow

/-- info: 'FirestoreAggregates.promoted_accumulator_stays_promoted' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreAggregates.promoted_accumulator_stays_promoted

/-- info: 'FirestoreAggregates.selected_rows_meet_all_requirements' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreAggregates.selected_rows_meet_all_requirements

/-- info: 'FirestoreAggregates.count_capped_on_both_sides' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreAggregates.count_capped_on_both_sides

/-- info: 'FirestoreAggregates.empty_sum' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreAggregates.empty_sum

/-- info: 'FirestoreAggregates.empty_average' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreAggregates.empty_average

/-- info: 'FirestoreAggregates.numeric_inputs_cannot_outnumber_rows' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreAggregates.numeric_inputs_cannot_outnumber_rows
