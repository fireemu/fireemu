import PubsubSnapshotLifetime.Spec

namespace SnapshotLifetime

theorem empty_has_full_lifetime (now : Int) : duration none now = some week := by
  rfl

theorem future_has_full_lifetime (published now : Int) (future : now ≤ published) :
    duration (some published) now = some week := by
  have nonpos : now - published ≤ 0 := by omega
  have value : age (some published) now = 0 := Int.max_eq_left nonpos
  rw [duration, value]
  rfl

theorem threshold_is_inclusive (now : Int) :
    duration (some (now - (week - hour))) now = some hour := by
  have offset : now - (now - (week - hour)) = week - hour := by omega
  have nonneg : 0 ≤ week - hour := by decide
  have value : age (some (now - (week - hour))) now = week - hour := by
    simp [age, offset, Int.max_eq_right nonneg]
  rw [duration, value]
  rfl

theorem rejects_iff_older (published now : Int) :
    duration (some published) now = none ↔ now - published > week - hour := by
  have positive : 0 < week - hour := by decide
  by_cases h : 0 ≤ now - published
  · have value : age (some published) now = now - published := Int.max_eq_right h
    rw [duration, value]
    by_cases expired : now - published > week - hour
    · simp [durationForAge, expired]
    · simp [durationForAge, expired]
  · have nonpos : now - published ≤ 0 := by omega
    have value : age (some published) now = 0 := Int.max_eq_left nonpos
    rw [duration, value]
    change some week = none ↔ _
    simp
    omega

theorem minimum_duration_equivalent (elapsed : Int) :
    elapsed > week - hour ↔ week - elapsed < hour := by omega

theorem exact_expiry_is_invisible (expires : Int) :
    visible (some expires) expires = false := by
  simp [visible]

theorem visibility_before (expires atTime : Int) :
    visible (some expires) atTime = true ↔ atTime < expires := by
  simp [visible]

end SnapshotLifetime
