import AdapterNoticeLimit.Theorems

/-- info: 'AN.seen_bounded' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms AN.seen_bounded

/-- info: 'AN.duplicate_is_silent' does not depend on any axioms -/
#guard_msgs in #print axioms AN.duplicate_is_silent

/-- info: 'AN.suppression_is_irreversible' depends on axioms: [propext] -/
#guard_msgs in #print axioms AN.suppression_is_irreversible

/-- info: 'AN.saturated_and_suppressed_is_silent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AN.saturated_and_suppressed_is_silent
