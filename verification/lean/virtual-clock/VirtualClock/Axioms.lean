import VirtualClock.Theorems

/-!
Build-time guard: the theorems use only Lean's standard axioms. A `sorry` (or a new axiom)
changes the printed list and fails the build.
-/

/-- info: 'VC.wf_init' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.wf_init

/-- info: 'VC.wf_step' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.wf_step

/-- info: 'VC.frozen_read' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.frozen_read

/-- info: 'VC.non_setter_keeps_read' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.non_setter_keeps_read

/-- info: 'VC.frozen_stands_still' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.frozen_stands_still

/--
info: 'VC.never_backwards_uncounted' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms VC.never_backwards_uncounted

/-- info: 'VC.reads_never_go_back' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.reads_never_go_back

/-- info: 'VC.read_steps_back_at_the_i128_top' depends on axioms: [propext] -/
#guard_msgs in #print axioms VC.read_steps_back_at_the_i128_top

/-- info: 'VC.refused_changes_nothing' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.refused_changes_nothing

/--
info: 'VC.refused_keeps_observation' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms VC.refused_keeps_observation

/--
info: 'VC.freeze_then_resume_keeps_the_instant' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms VC.freeze_then_resume_keeps_the_instant

/-- info: 'VC.freeze_idempotent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.freeze_idempotent

/-- info: 'VC.resume_idempotent' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.resume_idempotent

/-- info: 'VC.published_in_range' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.published_in_range

/-- info: 'VC.readFloor_init' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms VC.readFloor_init

/-- info: 'VC.readFloor_step' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.readFloor_step

/-- info: 'VC.read_in_range' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.read_in_range

/-- info: 'VC.read_below_the_range_minimum' depends on axioms: [propext] -/
#guard_msgs in #print axioms VC.read_below_the_range_minimum

/-- info: 'VC.budget_monotone' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.budget_monotone

/-- info: 'VC.last_revision_refuses' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.last_revision_refuses

/--
info: 'VC.publication_within_budget' depends on axioms: [propext, Classical.choice, Quot.sound]
-/
#guard_msgs in #print axioms VC.publication_within_budget

/-- info: 'VC.over_budget_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms VC.over_budget_refused
