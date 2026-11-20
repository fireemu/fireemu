import AuthSignupQuota.Spec

namespace AuthSignupQuota

theorem in_half_open_hour (instant : Int) :
    window instant ≤ instant ∧ instant < window instant + hour := by
  have positive : 0 < hour := by decide
  have lower := Int.emod_nonneg instant (by decide : hour ≠ 0)
  have upper := Int.emod_lt_of_pos instant positive
  unfold window
  omega

theorem ends_exclude_start_plus_duration (start duration : Int) :
    overrideActive start duration (start + duration) = false := by
  simp [overrideActive]

theorem enforce_admits_below_limit (usage : Usage) (limit : Nat) :
    offer .enforce limit usage = .tracked false ↔ usage.committed + usage.held < limit := by
  by_cases h : usage.committed + usage.held < limit <;> simp [offer, h]

theorem observe_does_not_refuse (usage : Usage) (limit : Nat) :
    offer .observe limit usage ≠ .exceeds := by simp [offer]

theorem tracked_release_reverses_reserve (usage : Usage) (over : Bool) :
    releaseTracked (addReservation usage (.tracked over)) = usage := by
  cases usage <;> simp [releaseTracked, addReservation]

theorem tracked_commit_preserves_total (usage : Usage) (held : 0 < usage.held) :
    (commitTracked usage).committed + (commitTracked usage).held = usage.committed + usage.held := by
  simp only [commitTracked]
  omega

theorem consumed_token_cannot_commit (before after : Snapshot) (usage : Usage) :
    finalize before after .commit true false usage = (.invalid, usage) := by rfl

theorem stale_token_releases_usage (before after : Snapshot) (usage : Usage)
    (h : fresh before after true = false) :
    finalize before after .commit true true usage = (.stale, releaseTracked usage) := by
  simp [finalize, h]

end AuthSignupQuota
