import ConfigDiscovery.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'ConfigDiscovery.working_directory_refuses_every_candidate' depends on axioms: [propext] -/
#guard_msgs in #print axioms ConfigDiscovery.working_directory_refuses_every_candidate

/-- info: 'ConfigDiscovery.two_local_canonical_files_are_ambiguous' depends on axioms: [propext] -/
#guard_msgs in #print axioms ConfigDiscovery.two_local_canonical_files_are_ambiguous

/-- info: 'ConfigDiscovery.working_canonical_precedes_firebase' depends on axioms: [propext] -/
#guard_msgs in #print axioms ConfigDiscovery.working_canonical_precedes_firebase

/-- info: 'ConfigDiscovery.nearest_trusted_firebase_is_chosen' depends on axioms: [propext] -/
#guard_msgs in #print axioms ConfigDiscovery.nearest_trusted_firebase_is_chosen
