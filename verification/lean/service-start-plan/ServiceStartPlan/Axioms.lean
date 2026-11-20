import ServiceStartPlan.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'ServiceStartPlan.support_tracks_functions' depends on axioms: [propext] -/
#guard_msgs in #print axioms ServiceStartPlan.support_tracks_functions

/-- info: 'ServiceStartPlan.explicit_pubsub_can_start_without_config' depends on axioms: [propext] -/
#guard_msgs in #print axioms ServiceStartPlan.explicit_pubsub_can_start_without_config

/-- info: 'ServiceStartPlan.implicit_database_needs_configuration' depends on axioms: [propext] -/
#guard_msgs in #print axioms ServiceStartPlan.implicit_database_needs_configuration

/-- info: 'ServiceStartPlan.explicit_missing_hosting_refuses' depends on axioms: [propext] -/
#guard_msgs in #print axioms ServiceStartPlan.explicit_missing_hosting_refuses
