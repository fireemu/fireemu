import FunctionsTriggerSelection.Theorems

/-! Build-time proof dependency guards. -/

/-- info: 'FTS.dispatch_append' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FTS.dispatch_append

/-- info: 'FTS.dispatch_reverse' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FTS.dispatch_reverse

/-- info: 'FTS.dispatch_selects_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FTS.dispatch_selects_iff

/-- info: 'FTS.disabled_stays_disabled' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FTS.disabled_stays_disabled

/-- info: 'FTS.discovery_chooses_first_matching' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FTS.discovery_chooses_first_matching

/-- info: 'FTS.named_wrong_event_precedes_region' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FTS.named_wrong_event_precedes_region
