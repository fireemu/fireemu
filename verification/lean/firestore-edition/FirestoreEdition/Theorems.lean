import FirestoreEdition.Spec

namespace FE

theorem standard_mongo_refused_first (catalog : String) :
    admit .standard .mongo catalog = .error .invalidCombination := rfl

theorem admitted_pipeline (e : Edition) (a : API) (catalog : String) (f : Flags)
    (h : admit e a catalog = .ok f) :
    f.pipeline = true ↔ e = .enterprise ∧ a = .native := by
  cases e <;> cases a <;> simp [admit] at h
  all_goals
    split at h
    · simp [flags] at h
      subst f
      simp
    · cases h

theorem admitted_core (e : Edition) (a : API) (catalog : String) (f : Flags)
    (h : admit e a catalog = .ok f) : f.core = true ↔ a = .native := by
  cases e <;> cases a <;> simp [admit] at h
  all_goals
    split at h
    · simp [flags] at h
      subst f
      simp
    · cases h

theorem search_status_agrees (e : Edition) (a : API) :
    (flags e a).text = (flags e a).geospatial := by
  cases e <;> cases a <;> rfl

end FE
