import Rfc3339Time.Spec

namespace RfcTime

private theorem eraYear_bounds (k : Int) (h0 : 0 ≤ k) (h1 : k < 146097) :
    0 ≤ eraYear k ∧ eraYear k < 400 := by
  unfold eraYear
  omega

-- The correction at the last day of the era keeps it in year 399.
private theorem eraYear_mono (a b : Int) (ha : 0 ≤ a) (hab : a ≤ b) (hb : b < 146097) :
    eraYear a ≤ eraYear b := by
  by_cases h : b = 146096
  · subst b
    have ⟨_, h⟩ := eraYear_bounds a ha (by omega)
    change eraYear a ≤ 399
    omega
  · unfold eraYear
    have h₁ : a / 36524 ≤ b / 36524 := by omega
    have h₂ : b / 1460 - a / 1460 ≤ b - a := by omega
    omega

private def nextYearStart (y : Int) : Int := if y = 399 then 146097 else yearStart (y + 1)

-- One finite check of the two endpoints of each of the 400 March-based years.
-- Monotonicity extends the endpoints to every day between them.
set_option maxRecDepth 4096 in
private theorem eraYear_endpoints : ∀ y : Fin 400,
    eraYear (yearStart (Int.ofNat y.val)) = Int.ofNat y.val ∧
    eraYear (nextYearStart (Int.ofNat y.val) - 1) = Int.ofNat y.val := by decide

private theorem yearStart_bounds (y : Int) (hy0 : 0 ≤ y) (hy1 : y ≤ 400) :
    0 ≤ yearStart y ∧ yearStart y ≤ 146097 := by
  unfold yearStart
  omega

private theorem yearStart_step (y : Int) :
    yearStart (y + 1) = yearStart y + 365 +
      (if (y + 1) % 4 = 0 then (if (y + 1) % 100 = 0 then 0 else 1) else 0) := by
  unfold yearStart
  split <;> (try split) <;> omega

private theorem eraYear_eq (y k : Int) (hy0 : 0 ≤ y) (hy1 : y < 400)
    (hk0 : yearStart y ≤ k) (hk1 : k < nextYearStart y) :
    eraYear k = y := by
  let j : Fin 400 := ⟨y.toNat, by omega⟩
  have hj : Int.ofNat j.val = y := by dsimp [j]; omega
  have ⟨h₁, h₂⟩ := eraYear_endpoints j
  rw [hj] at h₁ h₂
  have ⟨ha, _⟩ := yearStart_bounds y hy0 (by omega)
  have hb : nextYearStart y ≤ 146097 := by
    unfold nextYearStart
    split
    · decide
    · exact (yearStart_bounds (y + 1) (by omega) (by omega)).2
  have h₃ := eraYear_mono (yearStart y) k ha hk0 (by omega)
  have h₄ := eraYear_mono k (nextYearStart y - 1) (by omega) (by omega) (by omega)
  omega

private theorem eraYear_days (k : Int) (h0 : 0 ≤ k) (h1 : k < 146097) :
    yearStart (eraYear k) ≤ k ∧ k < nextYearStart (eraYear k) := by
  have ⟨hy0, hy1⟩ := eraYear_bounds k h0 h1
  generalize he : eraYear k = y at hy0 hy1 ⊢
  constructor
  · by_cases h : yearStart y ≤ k
    · exact h
    have h : k < yearStart y := by omega
    have hy : 0 ≤ y - 1 := by
      by_cases hz : y = 0
      · rw [hz] at h
        change k < 0 at h
        omega
      · omega
    let j : Fin 400 := ⟨(y - 1).toNat, by omega⟩
    have hj : Int.ofNat j.val = y - 1 := by dsimp [j]; omega
    have h₂ := (eraYear_endpoints j).2
    rw [hj] at h₂
    have hprev : nextYearStart (y - 1) = yearStart y := by
      unfold nextYearStart
      rw [ite_eq_right (by omega : y - 1 ≠ 399), show y - 1 + 1 = y by omega]
    rw [hprev] at h₂
    have ⟨_, hb⟩ := yearStart_bounds y hy0 (by omega)
    have h₃ := eraYear_mono k (yearStart y - 1) h0 (by omega) (by omega)
    omega
  · by_cases h : k < nextYearStart y
    · exact h
    have h : nextYearStart y ≤ k := by omega
    have hy : y + 1 < 400 := by
      by_cases hz : y = 399
      · rw [hz] at h
        change 146097 ≤ k at h
        omega
      · omega
    have hn : nextYearStart y = yearStart (y + 1) := ite_eq_right (by omega)
    rw [hn] at h
    let j : Fin 400 := ⟨(y + 1).toNat, by omega⟩
    have hj : Int.ofNat j.val = y + 1 := by dsimp [j]; omega
    have h₂ := (eraYear_endpoints j).1
    rw [hj] at h₂
    have ⟨ha, _⟩ := yearStart_bounds (y + 1) (by omega) (by omega)
    have h₃ := eraYear_mono (yearStart (y + 1)) k ha h h1
    omega

private def unMarchMonth (mp : Int) : Int := if mp < 10 then mp + 3 else mp - 9

private theorem year_length (k : Int) :
    nextYearStart (k % 400) - yearStart (k % 400) = if leap (k + 1) then 366 else 365 := by
  unfold nextYearStart
  have hk : k = 400 * (k / 400) + k % 400 := by omega
  have h4 : (k + 1) % 4 = (k % 400 + 1) % 4 := by omega
  have h100 : (k + 1) % 100 = (k % 400 + 1) % 100 := by omega
  have h400 : (k + 1) % 400 = 0 ↔ k % 400 = 399 := by omega
  simp only [leap, h4, h100, h400]
  -- The last year of the era ends in a Gregorian leap day.
  by_cases h : k % 400 = 399
  · simp [h, yearStart]
  · simp only [h, or_false, ite_false]
    rw [yearStart_step]
    split <;> (try split) <;> (try split) <;> omega

private theorem month_day_iff (k mp d : Int) (hm0 : 0 ≤ mp) (hm1 : mp < 12) :
    let m := unMarchMonth mp
    let y := if m ≤ 2 then k + 1 else k
    let doy := monthStart mp + d - 1
    ValidDate y m d ↔
      monthStart mp ≤ doy ∧ doy < monthStart (mp + 1) ∧
      doy < nextYearStart (k % 400) - yearStart (k % 400) := by
  dsimp only
  rw [year_length]
  have hm : mp = 0 ∨ mp = 1 ∨ mp = 2 ∨ mp = 3 ∨ mp = 4 ∨ mp = 5 ∨
      mp = 6 ∨ mp = 7 ∨ mp = 8 ∨ mp = 9 ∨ mp = 10 ∨ mp = 11 := by omega
  rcases hm with hm | hm | hm | hm | hm | hm | hm | hm | hm | hm | hm | hm <;>
    subst mp <;>
    by_cases hl : leap (k + 1) <;>
    simp [unMarchMonth, ValidDate, daysInMonth, monthStart, hl] <;> omega

private theorem unMarchMonth_marchMonth (m : Int) (h0 : 1 ≤ m) (h1 : m ≤ 12) :
    unMarchMonth (marchMonth m) = m := by
  unfold unMarchMonth marchMonth
  split <;> omega

private theorem marchMonth_unMarchMonth (mp : Int) (h0 : 0 ≤ mp) (h1 : mp < 12) :
    marchMonth (unMarchMonth mp) = mp := by
  unfold unMarchMonth marchMonth
  split <;> omega

private theorem valid_ordinal (y m d : Int) (h : ValidDate y m d) :
    let k := marchYear y m
    let mp := marchMonth m
    let doy := monthStart mp + d - 1
    0 ≤ doy ∧ doy < monthStart (mp + 1) ∧
      doy < nextYearStart (k % 400) - yearStart (k % 400) := by
  have hm := h
  unfold ValidDate at hm
  dsimp only
  have hmp := month_day_iff (marchYear y m) (marchMonth m) d
    (by unfold marchMonth; omega) (by unfold marchMonth; omega)
  dsimp only at hmp
  rw [unMarchMonth_marchMonth m hm.1 hm.2.1] at hmp
  have hy : (if m ≤ 2 then marchYear y m + 1 else marchYear y m) = y := by
    unfold marchYear
    split <;> simp_all
  rw [hy] at hmp
  obtain ⟨hl, hu, hy⟩ := hmp.mp h
  have hn : 0 ≤ monthStart (marchMonth m) := by unfold monthStart marchMonth; omega
  exact ⟨by omega, hu, hy⟩

private theorem monthIndex_eq (doy mp : Int)
    (h0 : monthStart mp ≤ doy) (h1 : doy < monthStart (mp + 1)) :
    (5 * doy + 2) / 153 = mp := by
  unfold monthStart at h0 h1
  omega

private theorem monthIndex_bounds (doy : Int) (h0 : 0 ≤ doy) (h1 : doy ≤ 365) :
    let mp := (5 * doy + 2) / 153
    0 ≤ mp ∧ mp < 12 ∧ monthStart mp ≤ doy ∧ doy < monthStart (mp + 1) := by
  dsimp only
  generalize hmp : (5 * doy + 2) / 153 = mp
  unfold monthStart
  omega

theorem civil_from_days_days_from_civil (y m d : Int) (h : ValidDate y m d) :
    civilFromDays (daysFromCivil y m d) = (y, m, d) := by
  let k := marchYear y m
  let mp := marchMonth m
  let doy := monthStart mp + d - 1
  let r := k % 400
  have ⟨h0, hm, h1⟩ := valid_ordinal y m d h
  change 0 ≤ doy at h0
  change doy < monthStart (mp + 1) at hm
  change doy < nextYearStart r - yearStart r at h1
  have hr0 : 0 ≤ r := by dsimp [r]; omega
  have hr1 : r < 400 := by dsimp [r]; omega
  have hl := yearStart_bounds r hr0 (by omega)
  have hu : nextYearStart r ≤ 146097 := by
    unfold nextYearStart
    split
    · decide
    · exact (yearStart_bounds (r + 1) (by omega) (by omega)).2
  have he := eraYear_eq r (yearStart r + doy) hr0 hr1 (by omega) (by omega)
  have hs : daysFromCivil y m d + 719468 = k / 400 * 146097 + (yearStart r + doy) := by
    unfold daysFromCivil
    change k / 400 * 146097 + (yearStart r + doy) - 719468 + 719468 = _
    omega
  have hd : (daysFromCivil y m d + 719468) / 146097 = k / 400 := by rw [hs]; omega
  have hn : (daysFromCivil y m d + 719468) % 146097 = yearStart r + doy := by rw [hs]; omega
  have hk : r + k / 400 * 400 = k := by dsimp [r]; omega
  have hmp := monthIndex_eq doy mp (by unfold doy; have := h.2.2.1; omega) hm
  have hmonth := unMarchMonth_marchMonth m h.1 h.2.1
  change unMarchMonth mp = m at hmonth
  unfold civilFromDays
  dsimp only
  rw [hd, hn, he, hk]
  have ho : yearStart r + doy - yearStart r = doy := by omega
  rw [ho, hmp]
  change ((if unMarchMonth mp ≤ 2 then k + 1 else k), unMarchMonth mp,
    doy - monthStart mp + 1) = (y, m, d)
  rw [hmonth]
  have hday : doy - monthStart mp + 1 = d := by dsimp [doy]; omega
  rw [hday]
  dsimp [k, marchYear]
  split <;> simp_all

private theorem civil_from_days_facts (n : Int) :
    let (y, m, d) := civilFromDays n
    ValidDate y m d ∧ daysFromCivil y m d = n := by
  let era := (n + 719468) / 146097
  let doe := (n + 719468) % 146097
  let r := eraYear doe
  let k := r + era * 400
  let doy := doe - yearStart r
  let mp := (5 * doy + 2) / 153
  let d := doy - monthStart mp + 1
  let m := unMarchMonth mp
  let y := if m ≤ 2 then k + 1 else k
  change ValidDate y m d ∧ daysFromCivil y m d = n
  have hdoe0 : 0 ≤ doe := by dsimp [doe]; omega
  have hdoe1 : doe < 146097 := by dsimp [doe]; omega
  have ⟨hr0, hr1⟩ := eraYear_bounds doe hdoe0 hdoe1
  have ⟨hl, hu⟩ := eraYear_days doe hdoe0 hdoe1
  change yearStart r ≤ doe at hl
  change doe < nextYearStart r at hu
  have h0 : 0 ≤ doy := by dsimp [doy]; omega
  have h1 : doy ≤ 365 := by
    have hr : k % 400 = r := by dsimp [k]; omega
    have hstep := year_length k
    rw [hr] at hstep
    dsimp [doy]
    split at hstep <;> omega
  have ⟨hmp0, hmp1, hm0, hm1⟩ := monthIndex_bounds doy h0 h1
  have hyear : marchYear y m = k := by
    dsimp [y, marchYear]
    split <;> simp_all
  have hkm : k % 400 = r := by dsimp [k]; omega
  have hkd : k / 400 = era := by dsimp [k]; omega
  have hday : monthStart mp + d - 1 = doy := by dsimp [d]; omega
  constructor
  · apply (month_day_iff k mp d hmp0 hmp1).mpr
    rw [hkm, hday]
    exact ⟨hm0, hm1, by dsimp [doy]; omega⟩
  · unfold daysFromCivil
    dsimp only
    rw [hyear, hkd, hkm, marchMonth_unMarchMonth mp hmp0 hmp1, hday]
    dsimp [doy, era, doe]
    omega

theorem civil_from_days_valid (n : Int) :
    ValidDate (civilFromDays n).1 (civilFromDays n).2.1 (civilFromDays n).2.2 :=
  (civil_from_days_facts n).1

theorem days_from_civil_civil_from_days (n : Int) :
    daysFromCivil (civilFromDays n).1 (civilFromDays n).2.1 (civilFromDays n).2.2 = n :=
  (civil_from_days_facts n).2

def CalendarLt (a b : Civil) : Prop :=
  a.1 < b.1 ∨ a.1 = b.1 ∧
    (a.2.1 < b.2.1 ∨ a.2.1 = b.2.1 ∧ a.2.2 < b.2.2)

private def yearBase (k : Int) : Int := k / 400 * 146097 + yearStart (k % 400)

private theorem yearBase_mono (a b : Int) (h : a ≤ b) : yearBase a ≤ yearBase b := by
  unfold yearBase
  have ha := yearStart_bounds (a % 400) (by omega) (by omega)
  have hb := yearStart_bounds (b % 400) (by omega) (by omega)
  by_cases he : a / 400 = b / 400
  · have hrem : a % 400 ≤ b % 400 := by omega
    generalize a % 400 = ar at *
    generalize b % 400 = br at *
    unfold yearStart
    have h₁ : ar / 4 ≤ br / 4 := by omega
    have h₂ : br / 100 - ar / 100 ≤ br - ar := by omega
    omega
  · omega

private theorem yearBase_step (k : Int) :
    yearBase (k + 1) = k / 400 * 146097 + nextYearStart (k % 400) := by
  unfold yearBase nextYearStart
  by_cases h : k % 400 = 399
  · have hd : (k + 1) / 400 = k / 400 + 1 := by omega
    have hm : (k + 1) % 400 = 0 := by omega
    simp [h, hd, hm, yearStart]
    omega
  · have hd : (k + 1) / 400 = k / 400 := by omega
    have hm : (k + 1) % 400 = k % 400 + 1 := by omega
    simp [h, hd, hm]

theorem days_from_civil_strict_mono (y m d y' m' d' : Int)
    (h : ValidDate y m d) (h' : ValidDate y' m' d')
    (hlt : CalendarLt (y, m, d) (y', m', d')) :
    daysFromCivil y m d < daysFromCivil y' m' d' := by
  let k := marchYear y m
  let k' := marchYear y' m'
  let mp := marchMonth m
  let mp' := marchMonth m'
  let doy := monthStart mp + d - 1
  let doy' := monthStart mp' + d' - 1
  have ⟨h0, hm, h1⟩ := valid_ordinal y m d h
  have ⟨h0', _, _⟩ := valid_ordinal y' m' d' h'
  change doy < monthStart (mp + 1) at hm
  change doy < nextYearStart (k % 400) - yearStart (k % 400) at h1
  change 0 ≤ doy' at h0'
  have order : k < k' ∨ k = k' ∧ (mp < mp' ∨ mp = mp' ∧ d < d') := by
    have ⟨hm0, hm1, _, _⟩ := h
    have ⟨hm0', hm1', _, _⟩ := h'
    simp only [CalendarLt] at hlt
    dsimp [k, k', mp, mp', marchYear, marchMonth]
    split <;> split <;> omega
  have lhs : daysFromCivil y m d = yearBase k + doy - 719468 := by
    unfold daysFromCivil yearBase
    change k / 400 * 146097 + (yearStart (k % 400) + doy) - 719468 = _
    omega
  have rhs : daysFromCivil y' m' d' = yearBase k' + doy' - 719468 := by
    unfold daysFromCivil yearBase
    change k' / 400 * 146097 + (yearStart (k' % 400) + doy') - 719468 = _
    omega
  rw [lhs, rhs]
  rcases order with hk | ⟨hk, hm' | ⟨hm', hd⟩⟩
  · have hle := yearBase_mono (k + 1) k' (by omega)
    rw [yearBase_step] at hle
    have hb : yearBase k = k / 400 * 146097 + yearStart (k % 400) := rfl
    rw [hb]
    omega
  · have hd' := h'.2.2.1
    have hb : monthStart (mp + 1) ≤ monthStart mp' := by unfold monthStart; omega
    rw [hk]
    dsimp [doy']
    omega
  · rw [hk]
    dsimp [doy, doy']
    rw [hm']
    omega

theorem daysInMonth_bound (y m : Int) : daysInMonth y m ≤ 31 := by
  unfold daysInMonth
  split <;> split <;> (try split) <;> omega

theorem civil_i64_never_clamps (n : Int) (hn : fitsI64 n) :
    civilFromDaysI64 n = civilFromDays n := by
  obtain ⟨y, m, d, hc⟩ : ∃ y m d, civilFromDays n = (y, m, d) := ⟨_, _, _, rfl⟩
  have hv := civil_from_days_valid n
  rw [hc] at hv
  change ValidDate y m d at hv
  obtain ⟨hm0, hm1, hd0, hd1⟩ := hv
  have hd2 := daysInMonth_bound y m
  have hm : fitsI64 m := by unfold fitsI64 i64Min i64Max; omega
  have hd : fitsI64 d := by unfold fitsI64 i64Min i64Max; omega
  have hy : fitsI64 y := by
    have hyear := congrArg Prod.fst hc
    have ⟨hr0, hr1⟩ := eraYear_bounds ((n + 719468) % 146097) (by omega) (by omega)
    unfold civilFromDays at hyear
    dsimp only at hyear
    unfold fitsI64 i64Min i64Max at hn ⊢
    split at hyear <;> omega
  simp [civilFromDaysI64, hc, hy, hm, hd]

private theorem raw_eq_daysFromCivil (y m d : Int) (h : ValidDate y m d) :
    daysFromCivilRaw y m d = daysFromCivil y m d := by
  have hm := h.1
  unfold daysFromCivilRaw truncMonthStart daysFromCivil monthStart marchMonth
  rw [Int.tmod_eq_emod_of_nonneg (by omega : 0 ≤ m + 9)]
  rw [Int.tdiv_eq_ediv_of_nonneg (by omega : 0 ≤ 153 * ((m + 9) % 12) + 2)]

theorem checked_days_strict_mono (y m d y' m' d' : Int)
    (h : ValidDate y m d) (h' : ValidDate y' m' d')
    (hf : CivilFits y m d) (hf' : CivilFits y' m' d')
    (hlt : CalendarLt (y, m, d) (y', m', d')) :
    ∃ a b, daysFromCivilChecked y m d = some a ∧
      daysFromCivilChecked y' m' d' = some b ∧ a < b := by
  exact ⟨_, _, by simp [daysFromCivilChecked, hf, raw_eq_daysFromCivil y m d h],
    by simp [daysFromCivilChecked, hf', raw_eq_daysFromCivil y' m' d' h'],
    days_from_civil_strict_mono y m d y' m' d' h h' hlt⟩

theorem civil_checked_round_trip (y m d : Int) (h : ValidDate y m d)
    (hf : CivilFits y m d) :
    (daysFromCivilChecked y m d).map civilFromDays = some (y, m, d) := by
  simp [daysFromCivilChecked, hf, raw_eq_daysFromCivil y m d h, civil_from_days_days_from_civil, h]

theorem days_from_civil_checked_right_inverse (n : Int)
    (hf : CivilFits (civilFromDays n).1 (civilFromDays n).2.1 (civilFromDays n).2.2) :
    daysFromCivilChecked (civilFromDays n).1 (civilFromDays n).2.1 (civilFromDays n).2.2 =
      some n := by
  simp [daysFromCivilChecked, hf, raw_eq_daysFromCivil _ _ _ (civil_from_days_valid n),
    days_from_civil_civil_from_days]

theorem i64_max_day_overflows_on_conversion_back :
    civilFromDays i64Max = (25252734927768524, 7, 27) ∧
    daysFromCivilChecked 25252734927768524 7 27 = none ∧
    daysFromCivilWrapping 25252734927768524 7 27 = i64Max := by decide

theorem i64_min_year_january_overflows :
    ValidDate i64Min 1 1 ∧ daysFromCivilChecked i64Min 1 1 = none := by decide

theorem wrapping_days_can_reverse_calendar_order :
    CalendarLt (25252734927768524, 7, 27) (25252734927768524, 7, 28) ∧
    ValidDate 25252734927768524 7 27 ∧ ValidDate 25252734927768524 7 28 ∧
    daysFromCivilWrapping 25252734927768524 7 27 = i64Max ∧
    daysFromCivilWrapping 25252734927768524 7 28 = i64Min := by
  unfold CalendarLt
  decide

theorem raw_civil_date_can_normalize :
    ¬ ValidDate 1970 2 30 ∧ daysFromCivilChecked 1970 2 30 = some 60 ∧
    civilFromDaysI64 60 = (1970, 3, 2) := by decide

end RfcTime
