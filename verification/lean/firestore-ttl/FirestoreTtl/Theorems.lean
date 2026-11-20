import FirestoreTtl.Spec

namespace FirestoreTtl

theorem admit_seconds_exact (negative : Bool) (input result : Nat) :
    admitSeconds negative input = .ok result ↔
      input = result ∧ input ≤ secondsLimit ∧ (negative = true → input = 0) := by
  unfold admitSeconds
  by_cases accepted : input ≤ secondsLimit ∧ (negative = true → input = 0)
  · rw [ite_eq_left accepted]
    exact ⟨fun h => ⟨Except.ok.inj h, accepted⟩, fun h => congrArg Except.ok h.1⟩
  · rw [ite_eq_right accepted]
    exact ⟨fun h => by contradiction, fun h => (accepted h.2).elim⟩

theorem parsed_seconds_within_limit (text : String) (seconds : Nat)
    (h : parseOffset text = .ok seconds) : seconds ≤ secondsLimit := by
  unfold parseOffset at h
  cases parts : readParts text with
  | error fault => simp [parts, Except.bind] at h
  | ok values =>
    rcases values with ⟨negative, input⟩
    have admitted : admitSeconds negative input = .ok seconds := by
      simpa [parts, Except.bind] using h
    obtain ⟨rfl, within, _⟩ := (admit_seconds_exact negative input seconds).mp admitted
    exact within

theorem expired_iff (storedAt offset current : Int)
    (interior : minI128 < current ∧ current ≤ maxI128) :
    expired (some storedAt) (some offset) current = true ↔ storedAt + offset < current := by
  have limits : minI128 ≤ maxI128 := by omega
  by_cases low : storedAt + offset ≤ minI128
  · have within : storedAt + offset < current := by omega
    simp [expired, saturate, Int.max_eq_left low, Int.min_eq_right limits, interior.1, within]
  · have lower : minI128 ≤ storedAt + offset := by omega
    by_cases high : storedAt + offset ≤ maxI128
    · simp [expired, saturate, Int.max_eq_right lower, Int.min_eq_right high]
    · have upper : maxI128 ≤ storedAt + offset := by omega
      have notExpired : ¬storedAt + offset < current := by omega
      have notSaturatedExpired : ¬maxI128 < current := by omega
      simp [expired, saturate, Int.max_eq_right lower, Int.min_eq_left upper,
        notExpired, notSaturatedExpired]

theorem missing_keeps_document (offset : Option Int) (current : Int) :
    expired none offset current = false := rfl

theorem omitted_offset_zero (stored : Option Int) (current : Int) :
    expired stored none current = expired stored (some 0) current := by
  cases stored <;> rfl

theorem expiry_is_strict (storedAt offset : Int)
    (interior : minI128 < storedAt + offset ∧ storedAt + offset ≤ maxI128) :
    expired (some storedAt) (some offset) (storedAt + offset) = false := by
  apply Bool.eq_false_iff.mpr
  intro h
  exact (Int.lt_irrefl _) ((expired_iff storedAt offset _ interior).mp h)

theorem expiry_monotone_in_now (stored offset : Option Int) (before after : Int)
    (time : before ≤ after) (h : expired stored offset before = true) :
    expired stored offset after = true := by
  cases stored with
  | none => simp [expired] at h
  | some storedAt =>
    simp [expired] at h ⊢
    omega

theorem greater_offset_delays_expiry (storedAt small large current : Int)
    (offset : small ≤ large) (interior : minI128 < current ∧ current ≤ maxI128)
    (h : expired (some storedAt) (some large) current = true) :
    expired (some storedAt) (some small) current = true := by
  rw [expired_iff storedAt large current interior] at h
  rw [expired_iff storedAt small current interior]
  omega

theorem clock_inside_timestamp_range (time : Int) :
    minTimestamp ≤ timestampAt time ∧ timestampAt time ≤ maxTimestamp := by
  have admitted : minTimestamp ≤ maxTimestamp := by decide
  unfold timestampAt
  omega

theorem clock_unchanged_inside_range (time : Int) (within : minTimestamp ≤ time ∧ time ≤ maxTimestamp) :
    timestampAt time = time := by
  simp [timestampAt, Int.max_eq_right within.1, Int.min_eq_right within.2]

end FirestoreTtl
