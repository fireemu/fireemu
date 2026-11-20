import CloudTasksQueue.Theorems

/-! Checks the axioms used by the exported correctness statements. -/

/-- info: 'CTQ.stale_finish_is_ignored' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CTQ.stale_finish_is_ignored

/-- info: 'CTQ.reset_changes_generation' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms CTQ.reset_changes_generation

/-- info: 'CTQ.reset_clears_occupancy' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTQ.reset_clears_occupancy

/-- info: 'CTQ.pending_delete_does_not_require_due' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTQ.pending_delete_does_not_require_due

/-- info: 'CTQ.exact_window_expiration' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CTQ.exact_window_expiration

/-- info: 'CTQ.window_retains_before_boundary' depends on axioms: [propext] -/
#guard_msgs in #print axioms CTQ.window_retains_before_boundary
