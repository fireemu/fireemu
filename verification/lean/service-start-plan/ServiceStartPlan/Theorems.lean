import ServiceStartPlan.Spec

namespace ServiceStartPlan

theorem support_tracks_functions (selected : List Service) (config : Config) :
    (starts true selected config .eventarc = starts true selected config .functions) ∧
    (starts true selected config .tasks = starts true selected config .functions) := by
  exact ⟨rfl, rfl⟩

theorem explicit_pubsub_can_start_without_config (selected : List Service) (config : Config)
    (present : selected.contains .pubsub = true) :
    starts true selected config .pubsub = true := by
  simp [starts, present]

theorem implicit_database_needs_configuration (selected : List Service) (config : Config)
    (absent : config.database = false) :
    starts false selected config .database = false := by
  simp [starts, absent]

theorem explicit_missing_hosting_refuses (selected : List Service) (config : Config)
    (present : selected.contains .hosting = true) (absent : config.hosting = false) :
    plan (some selected) config = .error .hosting := by
  simp [plan, present, absent]

end ServiceStartPlan
