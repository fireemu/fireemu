import RunnerLogBounds.Theorems

/-- info: 'RunnerLogBounds.bytes_cons' does not depend on any axioms -/
#guard_msgs in #print axioms RunnerLogBounds.bytes_cons

/-- info: 'RunnerLogBounds.bytes_append' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerLogBounds.bytes_append

/-- info: 'RunnerLogBounds.clip_fits' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RunnerLogBounds.clip_fits

/-- info: 'RunnerLogBounds.clip_is_prefix' depends on axioms: [propext] -/
#guard_msgs in #print axioms RunnerLogBounds.clip_is_prefix

/-- info: 'RunnerLogBounds.clip_longest' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RunnerLogBounds.clip_longest

/-- info: 'RunnerLogBounds.bound_fits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerLogBounds.bound_fits

/-- info: 'RunnerLogBounds.exact_copy_when_fitting' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RunnerLogBounds.exact_copy_when_fitting

/-- info: 'RunnerLogBounds.normalization_examples' does not depend on any axioms -/
#guard_msgs in #print axioms RunnerLogBounds.normalization_examples
