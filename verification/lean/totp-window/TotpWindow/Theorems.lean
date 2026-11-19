import TotpWindow.Spec

namespace TW

theorem time_step_clamped_floor (period : Nat) (nanos : Int) :
    timeStep period nanos = min maxStep (floorStep period nanos).toNat := by
  unfold timeStep floorStep
  dsimp only
  rw [← Int.ediv_ediv_of_nonneg (by decide : 0 ≤ nanosPerSecond)]
  split
  · rename_i refused
    rcases refused with nonpos | zero
    · by_cases hp : period = 0
      · simp [hp]
      · have negative : nanos / nanosPerSecond / (period : Int) ≤ 0 := by
          simpa using Int.ediv_le_ediv (c := (period : Int)) (by omega) nonpos
        have : (nanos / nanosPerSecond / (period : Int)).toNat = 0 := by omega
        simp [this]
    · simp [zero]
  · rfl

theorem time_step_floor {period : Nat} {nanos : Int} (hp : 0 < period) (hn : 0 ≤ nanos)
    (fits : floorStep period nanos ≤ (maxStep : Int)) :
    (timeStep period nanos : Int) = floorStep period nanos := by
  have nonnegative : 0 ≤ floorStep period nanos :=
    Int.ediv_nonneg hn (Int.mul_nonneg (by decide) (by omega))
  rw [time_step_clamped_floor, Nat.min_eq_right (by omega : (floorStep period nanos).toNat ≤ maxStep)]
  omega

theorem time_step_monotone {period : Nat} {a b : Int} (hab : a ≤ b) :
    timeStep period a ≤ timeStep period b := by
  rw [time_step_clamped_floor, time_step_clamped_floor]
  by_cases hp : period = 0
  · simp [floorStep, hp]
  · have positive : 0 < nanosPerSecond * (period : Int) :=
      Int.mul_pos (by decide) (by omega)
    have ordered := Int.toNat_le_toNat (Int.ediv_le_ediv positive hab)
    change min maxStep (a / (nanosPerSecond * (period : Int))).toNat ≤
      min maxStep (b / (nanosPerSecond * (period : Int))).toNat
    omega

theorem time_step_constant_in_period {period : Nat} {a b step : Int} (hp : 0 < period)
    (ha : step * (nanosPerSecond * (period : Int)) ≤ a)
    (hb : b < step * (nanosPerSecond * (period : Int)) + nanosPerSecond * (period : Int))
    (hab : a ≤ b) :
    timeStep period a = timeStep period b := by
  have positive : 0 < nanosPerSecond * (period : Int) :=
    Int.mul_pos (by decide) (by omega)
  have sameA : floorStep period a = step := (Int.ediv_eq_iff_of_pos positive).2 ⟨ha, by omega⟩
  have sameB : floorStep period b = step := (Int.ediv_eq_iff_of_pos positive).2 ⟨by omega, hb⟩
  simp [time_step_clamped_floor, sameA, sameB]

theorem pre_epoch_clamps : timeStep 30 (-1) = 0 ∧ floorStep 30 (-1) = -1 := by decide

theorem counter_saturates_above_u64 :
    timeStep 30 ((maxStep + 1 : Nat) * nanosPerSecond * 30) = maxStep ∧
    floorStep 30 ((maxStep + 1 : Nat) * nanosPerSecond * 30) = (maxStep : Int) + 1 := by decide

theorem zero_period_returns_zero (nanos : Int) : timeStep 0 nanos = 0 := by simp [timeStep]

theorem truncate_lt (digest : Digest) : truncate digest < 2 ^ 31 := by
  have bound := offset_lt digest
  let i := offset digest
  have hi : i < 16 := bound
  have h := Nat.mod_lt (digest[i]'(by omega)).toNat (by decide : 0 < 128)
  have h₁ := UInt8.toNat_lt_size (digest[i + 1]'(by omega))
  have h₂ := UInt8.toNat_lt_size (digest[i + 2]'(by omega))
  have h₃ := UInt8.toNat_lt_size (digest[i + 3]'(by omega))
  change _ < 256 at h₁ h₂ h₃
  unfold truncate
  change 16777216 * ((digest[i]'(by omega)).toNat % 128) +
    65536 * (digest[i + 1]'(by omega)).toNat +
    256 * (digest[i + 2]'(by omega)).toNat + (digest[i + 3]'(by omega)).toNat < 2 ^ 31
  omega

theorem hotp_lt (hmac : Hmac) (step digits : Nat) : hotp hmac step digits < 10 ^ digits :=
  Nat.lt_of_lt_of_le (Nat.mod_lt _ (Nat.pow_pos (by decide)))
    (Nat.pow_le_pow_right (by decide) (Nat.min_le_left _ _))

theorem show_code_padded (hmac : Hmac) (step digits : Nat) :
    (showCode hmac step digits).length = displayWidth digits ∧
    Nat.ofDigitChars 10 (showCode hmac step digits).toList 0 = hotp hmac step digits := by
  have positive : 0 < displayWidth digits := by
    unfold displayWidth
    omega
  have fits : hotp hmac step digits < 10 ^ displayWidth digits :=
    Nat.lt_of_lt_of_le (Nat.mod_lt _ (Nat.pow_pos (by decide)))
      (Nat.pow_le_pow_right (by decide) (Nat.le_max_right _ _))
  have len := (Nat.length_repr_le_iff positive).2 fits
  constructor
  · simp only [showCode, String.length_ofList, List.length_append, List.length_replicate,
      String.length_toList]
    omega
  · simp [showCode, Nat.ofDigitChars_append, Nat.ofDigitChars_replicate_zero,
      Nat.repr_eq_ofList_toDigits, Nat.ofDigitChars_ten_toDigits]

theorem show_code_width {digits : Nat} (hmac : Hmac) (step : Nat)
    (positive : 1 ≤ digits) (limit : digits ≤ 9) :
    (showCode hmac step digits).length = digits := by
  have width := (show_code_padded hmac step digits).1
  rw [displayWidth, Nat.min_eq_left limit, Nat.max_eq_right positive] at width
  exact width

private theorem hotp_zero_digits (hmac : Hmac) (step : Nat) : hotp hmac step 0 = 0 := by
  simp [hotp, Nat.mod_one]

theorem zero_digits_displays_zero (hmac : Hmac) (step : Nat) :
    showCode hmac step 0 = "0" := by
  unfold showCode
  rw [hotp_zero_digits]
  decide

theorem ten_digits_displays_nine (hmac : Hmac) (step : Nat) :
    (showCode hmac step 10).length = 9 := by
  exact (show_code_padded hmac step 10).1

theorem window_no_overflow {current window : Nat} (hc : current ≤ maxStep) (hw : window ≤ 255) :
    windowLow current window ≤ current ∧ current ≤ windowHigh current window ∧
    windowHigh current window ≤ maxStep ∧
    windowHigh current window - windowLow current window + 1 ≤ 511 := by
  simp only [windowLow, windowHigh]
  omega

theorem time_step_window_no_overflow (period : Nat) (nanos : Int) {window : Nat}
    (hw : window ≤ 255) :
    windowLow (timeStep period nanos) window ≤ timeStep period nanos ∧
    timeStep period nanos ≤ windowHigh (timeStep period nanos) window ∧
    windowHigh (timeStep period nanos) window ≤ maxStep ∧
    windowHigh (timeStep period nanos) window - windowLow (timeStep period nanos) window + 1 ≤ 511 :=
  window_no_overflow (by rw [time_step_clamped_floor]; exact Nat.min_le_left _ _) hw

private theorem mem_window {current window step : Nat} (hc : current ≤ maxStep) :
    step ∈ windowSteps current window ↔
      windowLow current window ≤ step ∧ step ≤ windowHigh current window := by
  have lo := Nat.sub_le current window
  have hi : current ≤ windowHigh current window := by unfold windowHigh; omega
  simp only [windowSteps, List.mem_range'_1]
  change windowLow current window ≤ step ∧
    step < windowLow current window + (windowHigh current window - windowLow current window + 1) ↔ _
  unfold windowLow at *
  omega

theorem match_step_window_accepted_iff {current window step : Nat} {last : Option Nat}
    {testStep : Nat → Bool} (hc : current ≤ maxStep) :
    matchStepWindow current window last testStep = .accepted step ↔
      windowLow current window ≤ step ∧ step ≤ windowHigh current window ∧
        testStep step = true ∧ fresh last step = true ∧
        ∀ prior, windowLow current window ≤ prior → prior < step →
          ¬ (testStep prior = true ∧ fresh last prior = true) := by
  unfold matchStepWindow
  dsimp only
  generalize found : (windowSteps current window).find? (fun s => testStep s && fresh last s) = hit
  cases hit with
  | none =>
    constructor
    · intro h
      dsimp only at h
      split at h <;> cases h
    · intro h
      have absent := List.find?_eq_none.mp found step (mem_window hc |>.2 ⟨h.1, h.2.1⟩)
      simp [h.2.2.1, h.2.2.2.1] at absent
  | some first =>
    simp only [CodeMatch.accepted.injEq]
    have contains := List.mem_of_find?_eq_some found
    have recognized := List.find?_some found
    have ordered : (windowSteps current window).Pairwise (· < ·) := List.pairwise_lt_range'
    obtain ⟨_, earlier, later, partition, skipped⟩ := List.find?_eq_some_iff_append.mp found
    have before (prior : Nat) (inRange : prior ∈ windowSteps current window) (lt : prior < first) :
        ¬ (testStep prior = true ∧ fresh last prior = true) := by
      rw [partition] at inRange ordered
      rcases List.mem_append.mp inRange with hp | hs
      · intro ⟨matchedPrior, freshPrior⟩
        simpa [matchedPrior, freshPrior] using skipped prior hp
      · have tail := (List.pairwise_append.mp ordered).2.1
        rcases List.mem_cons.mp hs with rfl | hs
        · omega
        · have := List.rel_of_pairwise_cons tail hs
          omega
    have ⟨lo, hi⟩ := (mem_window hc).1 contains
    have ⟨matched, new⟩ := Bool.and_eq_true_iff.mp recognized
    constructor
    · rintro rfl
      exact ⟨lo, hi, matched, new, fun prior hlow lt =>
        before prior ((mem_window hc).2 ⟨hlow, by omega⟩) lt⟩
    · rintro ⟨low, high, matchedStep, freshStep, minimal⟩
      rcases Nat.lt_trichotomy first step with smaller | equal | larger
      · exact False.elim (minimal first lo smaller ⟨matched, new⟩)
      · exact equal
      · exact False.elim (before step ((mem_window hc).2 ⟨low, high⟩) larger ⟨matchedStep, freshStep⟩)

theorem match_code_accepts_iff (hmac : Hmac) (detached : Bool) (period digits window : Nat)
    (last : Option Nat) (code : Nat) (nanos : Int) :
    (∃ step, matchCode hmac detached period digits window last code nanos = .accepted step) ↔
      detached = false ∧ ∃ step,
        let current := timeStep period nanos
        windowLow current window ≤ step ∧ step ≤ windowHigh current window ∧
          hotp hmac step digits = code ∧ fresh last step = true := by
  have hc : timeStep period nanos ≤ maxStep := by
    rw [time_step_clamped_floor]
    exact Nat.min_le_left _ _
  unfold matchCode
  generalize timeStep period nanos = current at hc ⊢
  cases detached
  · simp only [Bool.false_eq_true, ite_false, true_and]
    constructor
    · rintro ⟨step, accepted⟩
      obtain ⟨low, high, eq, freshStep, _⟩ := (match_step_window_accepted_iff hc).1 accepted
      exact ⟨step, low, high, by simpa using eq, freshStep⟩
    · rintro ⟨step, low, high, eq, freshStep⟩
      unfold matchStepWindow
      dsimp only
      cases found : (windowSteps current window).find?
          (fun s => (hotp hmac s digits == code) && fresh last s) with
      | none =>
        have absent := List.find?_eq_none.mp found step ((mem_window hc).2 ⟨low, high⟩)
        simp [eq, freshStep] at absent
      | some first => exact ⟨first, rfl⟩
  · simp

theorem match_code_rejects_without_in_window_match (hmac : Hmac) (period digits window : Nat)
    (last : Option Nat) (code : Nat) (nanos : Int)
    (absent : ∀ step ∈ windowSteps (timeStep period nanos) window, hotp hmac step digits ≠ code) :
    matchCode hmac false period digits window last code nanos = .noMatch := by
  unfold matchCode
  generalize timeStep period nanos = current at absent ⊢
  simp only [Bool.false_eq_true, ite_false, matchStepWindow]
  have noHit : (windowSteps current window).find?
      (fun s => (hotp hmac s digits == code) && fresh last s) = none := by
    apply List.find?_eq_none.mpr
    intro step member
    simp [absent step member]
  have noMatch : (windowSteps current window).any
      (fun s => hotp hmac s digits == code) = false := by
    apply List.any_eq_false.mpr
    intro step member
    simp [absent step member]
  simp only [noHit, noMatch, Bool.false_eq_true, ite_false]

theorem replay_can_refuse_a_matching_code :
    matchStepWindow 1 0 (some 1) (· == 1) = .replayed := by decide

theorem outside_code_can_collide (hmac : Hmac) :
    hotp hmac 2 0 = hotp hmac 1 0 ∧
    matchCode hmac false 30 0 0 none (hotp hmac 2 0) 30000000000 = .accepted 1 := by
  have current : timeStep 30 30000000000 = 1 := by decide
  have steps : windowSteps 1 0 = [1] := by decide
  simp only [hotp_zero_digits]
  simp [matchCode, current, matchStepWindow, steps, fresh, hotp_zero_digits]

end TW
