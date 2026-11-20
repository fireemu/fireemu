import EventOutbox.Theorems

/-! Build-time checks for the permitted Lean axioms. -/

/-- info: 'EventOutbox.ordered_key_transitive' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EventOutbox.ordered_key_transitive

/-- info: 'EventOutbox.ordered_key_total' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EventOutbox.ordered_key_total

/-- info: 'EventOutbox.dispatch_is_canonical' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EventOutbox.dispatch_is_canonical

/-- info: 'EventOutbox.pending_exact' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventOutbox.pending_exact

/-- info: 'EventOutbox.queue_exact' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms EventOutbox.queue_exact

/-- info: 'EventOutbox.terminal_window_is_bounded' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EventOutbox.terminal_window_is_bounded

/-- info: 'EventOutbox.terminal_window_keeps_everything_that_fits' depends on axioms: [propext] -/
#guard_msgs in #print axioms EventOutbox.terminal_window_keeps_everything_that_fits

/-- info: 'EventOutbox.duplicate_preserves_views' depends on axioms: [propext] -/
#guard_msgs in #print axioms EventOutbox.duplicate_preserves_views
