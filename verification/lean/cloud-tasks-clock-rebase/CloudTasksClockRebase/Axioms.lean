import CloudTasksClockRebase.Theorems

/-! Checks the axioms used by the exported correctness statements. -/

/-- info: 'CTRebase.equal_clocks' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTRebase.equal_clocks

/-- info: 'CTRebase.keep_ties' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTRebase.keep_ties

/-- info: 'CTRebase.keep_when_no_nearer' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTRebase.keep_when_no_nearer

/-- info: 'CTRebase.clip_of_range' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTRebase.clip_of_range

/-- info: 'CTRebase.delay_preserved' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CTRebase.delay_preserved

/-- info: 'CTRebase.saturated_distances_can_tie' does not depend on any axioms -/
#guard_msgs in #print axioms CTRebase.saturated_distances_can_tie
