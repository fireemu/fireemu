import ClockCalendar.Model

namespace CC

private def marchBase (y : Int) : Int := 365 * y + y / 4 - y / 100 + y / 400

private def eraBase (y : Int) : Int := marchBase y

private def estimate (d : Int) : Int :=
  (d - d / 1460 + d / 36524 - d / 146096) / 365

private theorem marchBase_era (y : Int) :
    marchBase y = y / 400 * 146097 + eraBase (y % 400) := by
  unfold eraBase marchBase
  have h := Int.emod_add_mul_ediv y 400
  have h0 := Int.emod_nonneg y (by decide : (400 : Int) ≠ 0)
  have h1 := Int.emod_lt_of_pos y (by decide : (0 : Int) < 400)
  have h4 : y / 4 = y / 400 * 100 + (y % 400) / 4 := by omega
  have h100 : y / 100 = y / 400 * 4 + (y % 400) / 100 := by omega
  omega

private theorem marchBase_succ (y : Int) :
    marchBase y - marchBase (y - 1) = 365 + (if leap y then 1 else 0) := by
  have h (k : Int) (hk : 0 < k) : y / k - (y - 1) / k = if y % k = 0 then 1 else 0 := by
    split <;> rename_i hm
    · have hd := Int.emod_add_mul_ediv y k
      rw [hm, Int.zero_add] at hd
      have : (y - 1) / k = y / k - 1 := (Int.ediv_eq_iff_of_pos hk).2 (by
        constructor <;> simp [Int.sub_mul, Int.mul_comm k (y / k)] at * <;> omega)
      omega
    · have hd := Int.emod_add_mul_ediv y k
      have hp := Int.emod_nonneg y (by omega : k ≠ 0)
      have ht := Int.emod_lt_of_pos y hk
      have : (y - 1) / k = y / k := (Int.ediv_eq_iff_of_pos hk).2 (by
        rw [Int.mul_comm (y / k) k]
        omega)
      omega
  have h4 := h 4 (by decide)
  have h100 := h 100 (by decide)
  have h400 := h 400 (by decide)
  have hA : y % 400 = 0 → y % 100 = 0 := by omega
  have hB : y % 100 = 0 → y % 4 = 0 := by omega
  unfold marchBase leap
  by_cases ha : y % 4 = 0 <;> by_cases hb : y % 100 = 0 <;> by_cases hc : y % 400 = 0 <;>
    simp [ha, hb, hc] at * <;> omega

private theorem month_offset {m : Int} (hm : 1 ≤ m ∧ m ≤ 12) :
    (153 * ((m + 9) % 12) + 2) / 5 + (if m ≤ 2 then 0 else 59) =
      monthPrefix m + (if m ≤ 2 then 306 else 0) := by
  have hs : m = 1 ∨ m = 2 ∨ m = 3 ∨ m = 4 ∨ m = 5 ∨ m = 6 ∨ m = 7 ∨ m = 8 ∨ m = 9 ∨ m = 10 ∨ m = 11 ∨ m = 12 := by omega
  rcases hs with h | h | h | h | h | h | h | h | h | h | h | h <;> subst m <;> decide

theorem days_from_civil_spec {y m d : Int} (hm : 1 ≤ m ∧ m ≤ 12) :
    daysFromCivil y m d = dayCount y m d := by
  unfold daysFromCivil dayCount
  simp only
  let a := if m ≤ 2 then y - 1 else y
  have hEra := marchBase_era a
  unfold eraBase marchBase at hEra
  have hRem : a % 400 / 400 = 0 := by omega
  change a / 400 * 146097 + (a % 400 * 365 + a % 400 / 4 - a % 400 / 100 +
    ((153 * ((m + 9) % 12) + 2) / 5 + d - 1)) - 719468 = _
  dsimp [a] at *
  have h := month_offset hm
  have hy := marchBase_succ y
  unfold marchBase at *
  by_cases hb : m ≤ 2
  · have hlt : ¬ 2 < m := by omega
    simp [hb, hlt] at hEra hRem h ⊢
    omega
  · have hlt : 2 < m := by omega
    by_cases hl : leap y <;> simp [hb, hl, hlt] at hEra hRem h hy ⊢ <;> omega

private theorem estimate_mono {a b : Int} (ha : 0 ≤ a) (hb : b ≤ 146096) (h : a ≤ b) :
    estimate a ≤ estimate b := by
  unfold estimate
  have hd : a / 36524 ≤ b / 36524 := by omega
  have hq : b / 1460 - a / 1460 ≤ b - a := by omega
  by_cases he : b = 146096
  · subst b
    by_cases he' : a = 146096
    · simp [he']
    · by_cases hn : a ≥ 146000
      · have : a / 1460 = 100 := by omega
        omega
      · omega
  · have : a / 146096 = 0 := by omega
    have : b / 146096 = 0 := by omega
    omega

set_option maxRecDepth 8192 in
set_option maxHeartbeats 1000000 in
private theorem estimate_endpoints {y : Int} (hy : 0 ≤ y ∧ y < 400) :
    estimate (eraBase y) = y ∧ estimate (eraBase (y + 1) - 1) = y := by
  have cert : ((List.range 400).all fun n =>
      decide (estimate (eraBase (n : Int)) = n ∧ estimate (eraBase ((n : Int) + 1) - 1) = n)) = true := by
    decide
  have hmem : y.toNat ∈ List.range 400 := List.mem_range.mpr (by omega)
  have hc := List.all_eq_true.mp cert y.toNat hmem
  simpa [Int.toNat_of_nonneg hy.1] using hc

private theorem estimate_eq {y d : Int} (hy : 0 ≤ y ∧ y < 400)
    (hd : eraBase y ≤ d ∧ d < eraBase (y + 1)) : estimate d = y := by
  have hl : 0 ≤ eraBase y := by unfold eraBase marchBase; omega
  have hu : eraBase (y + 1) - 1 ≤ 146096 := by unfold eraBase marchBase; omega
  have he := estimate_endpoints hy
  have h₁ := estimate_mono hl (by omega : d ≤ 146096) hd.1
  have h₂ := estimate_mono (by omega : 0 ≤ d) hu (by omega : d ≤ eraBase (y + 1) - 1)
  omega

private theorem march_day {y m d : Int} (h : validDate y m d) :
    let a := if m ≤ 2 then y - 1 else y
    let p := (m + 9) % 12
    let n := (153 * p + 2) / 5 + d - 1
    0 ≤ n ∧ n < 365 + (if leap (a + 1) then 1 else 0) ∧
      (5 * n + 2) / 153 = p ∧ (if p < 10 then p + 3 else p - 9) = m := by
  simp only [validDate] at h
  obtain ⟨hm, hm', hd, hd'⟩ := h
  have hs : m = 1 ∨ m = 2 ∨ m = 3 ∨ m = 4 ∨ m = 5 ∨ m = 6 ∨ m = 7 ∨ m = 8 ∨ m = 9 ∨ m = 10 ∨ m = 11 ∨ m = 12 := by omega
  rcases hs with rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl <;>
    simp [monthLength] at hd' ⊢
  all_goals first
    | omega
    | split at hd' <;> rename_i hLeap <;> simp [hLeap] <;> omega
    | split <;> omega

private theorem civil_round_trip_i64 {y m d : Int} (hy : minI64 ≤ y ∧ y ≤ maxI64) (h : validDate y m d) :
    civilFromDays (daysFromCivil y m d) = (y, m, d) := by
  let a := if m ≤ 2 then y - 1 else y
  let r := a % 400
  let e := a / 400
  let p := (m + 9) % 12
  let n := (153 * p + 2) / 5 + d - 1
  have hm := march_day h
  change 0 ≤ n ∧ n < 365 + (if leap (a + 1) then 1 else 0) ∧
    (5 * n + 2) / 153 = p ∧ (if p < 10 then p + 3 else p - 9) = m at hm
  have hr : 0 ≤ r ∧ r < 400 := by dsimp [r]; omega
  have ha : a = 400 * e + r := by dsimp [r, e]; omega
  have hnext : eraBase (r + 1) - eraBase r = 365 + (if leap (a + 1) then 1 else 0) := by
    have hb := marchBase_succ (r + 1)
    have hLeap : leap (r + 1) = leap (a + 1) := by
      unfold leap
      have : (r + 1) % 4 = (a + 1) % 4 := by omega
      have : (r + 1) % 100 = (a + 1) % 100 := by omega
      have : (r + 1) % 400 = (a + 1) % 400 := by omega
      simp_all only
    rw [← hLeap]
    unfold eraBase marchBase at *
    simp only [Int.add_sub_cancel] at hb
    omega
  have hbounds : eraBase r ≤ eraBase r + n ∧ eraBase r + n < eraBase (r + 1) := by omega
  have hest := estimate_eq hr hbounds
  have hz : daysFromCivil y m d + 719468 = e * 146097 + (eraBase r + n) := by
    unfold daysFromCivil
    change e * 146097 + (r * 365 + r / 4 - r / 100 + n) - 719468 + 719468 = _
    unfold eraBase marchBase
    omega
  have hlim : 0 ≤ eraBase r + n ∧ eraBase r + n < 146097 := by
    unfold eraBase marchBase at *
    omega
  have hdiv : (daysFromCivil y m d + 719468) / 146097 = e := by omega
  have hmod : (daysFromCivil y m d + 719468) % 146097 = eraBase r + n := by omega
  have hw : civilFromDaysWide (daysFromCivil y m d) = (y, m, d) := by
    unfold civilFromDaysWide
    simp only [hdiv, hmod]
    have hYoe : (eraBase r + n - (eraBase r + n) / 1460 +
      (eraBase r + n) / 36524 - (eraBase r + n) / 146096) / 365 = r := hest
    simp only [hYoe]
    have hdoy : eraBase r + n - (365 * r + r / 4 - r / 100) = n := by unfold eraBase marchBase; omega
    simp only [hdoy, hm.2.2.1, hm.2.2.2]
    have hd : n - (153 * p + 2) / 5 + 1 = d := by dsimp [n]; omega
    rw [hd]
    have hy' : (if m ≤ 2 then r + e * 400 + 1 else r + e * 400) = y := by
      dsimp [a] at ha
      split <;> simp_all only [ite_true, ite_false] <;> omega
    rw [hy']
  unfold civilFromDays
  rw [hw]
  unfold checked minI64 maxI64 at *
  obtain ⟨hm1, hm2, hd1, hd2⟩ := h
  have hd' : d ≤ 31 := by
    unfold monthLength at hd2
    split at hd2 <;> split at hd2 <;> omega
  have hY : -9223372036854775808 ≤ y ∧ y ≤ 9223372036854775807 := by omega
  have hM : -9223372036854775808 ≤ m ∧ m ≤ 9223372036854775807 := by omega
  have hD : -9223372036854775808 ≤ d ∧ d ≤ 9223372036854775807 := by omega
  simp [hY, hM, hD]

theorem civil_round_trip {y m d : Int} (hy : inYearRange y) (h : validDate y m d) :
    civilFromDays (daysFromCivil y m d) = (y, m, d) := by
  apply civil_round_trip_i64 _ h
  unfold inYearRange at hy
  unfold minI64 maxI64
  omega


theorem month_length_bounds (y m : Int) : 28 ≤ monthLength y m ∧ monthLength y m ≤ 31 := by
  unfold monthLength
  split <;> split <;> decide

def monthStart (index : Int) : Int := dayCount (index / 12) (index % 12 + 1) 1

theorem month_start_date {y m : Int} (hm : 1 ≤ m ∧ m ≤ 12) :
    monthStart (y * 12 + m - 1) = dayCount y m 1 := by
  unfold monthStart
  have hd : (y * 12 + m - 1) / 12 = y := by omega
  have hr : (y * 12 + m - 1) % 12 + 1 = m := by omega
  rw [hd, hr]

theorem month_start_succ (n : Int) :
    monthStart (n + 1) = monthStart n + monthLength (n / 12) (n % 12 + 1) := by
  let y := n / 12
  let m := n % 12 + 1
  have hm : 1 ≤ m ∧ m ≤ 12 := by dsimp [m]; omega
  have hn : n = y * 12 + m - 1 := by dsimp [y, m]; omega
  change monthStart (n + 1) = dayCount y m 1 + monthLength y m
  by_cases h : m = 12
  · have hi : n + 1 = (y + 1) * 12 + 1 - 1 := by omega
    rw [hi, month_start_date (by decide), h]
    have hb := marchBase_succ y
    unfold marchBase at hb
    simp [dayCount, monthPrefix, monthLength]
    by_cases hl : leap y <;> simp [hl] at * <;> omega
  · have hi : n + 1 = y * 12 + (m + 1) - 1 := by omega
    rw [hi, month_start_date (by omega)]
    have hs : m = 1 ∨ m = 2 ∨ m = 3 ∨ m = 4 ∨ m = 5 ∨ m = 6 ∨ m = 7 ∨ m = 8 ∨ m = 9 ∨ m = 10 ∨ m = 11 := by omega
    rcases hs with h | h | h | h | h | h | h | h | h | h | h <;> rw [h] <;>
      by_cases hl : leap y <;> simp [dayCount, monthPrefix, monthLength, hl] <;> omega

theorem month_start_mono {a b : Int} (h : a ≤ b) : monthStart a ≤ monthStart b := by
  have hnat : b = a + (b - a).toNat := by omega
  rw [hnat]
  generalize (b - a).toNat = k
  clear hnat h b
  induction k with
  | zero => simp
  | succ k ih =>
    have he : a + (↑(k + 1) : Int) = (a + (k : Int)) + 1 := by omega
    rw [he, month_start_succ]
    have hlen := month_length_bounds ((a + (k : Int)) / 12) ((a + (k : Int)) % 12 + 1)
    omega

theorem civil_day_bounds {c : Civil} (h : validDate c.year c.month c.day) :
    monthStart c.monthIndex ≤ c.dayIndex ∧ c.dayIndex < monthStart (c.monthIndex + 1) := by
  obtain ⟨hm, hm', hd, hd'⟩ := h
  have hs : monthStart c.monthIndex = dayCount c.year c.month 1 := month_start_date ⟨hm, hm'⟩
  have hy : c.monthIndex / 12 = c.year := by unfold Civil.monthIndex; omega
  have hmo : c.monthIndex % 12 + 1 = c.month := by unfold Civil.monthIndex; omega
  rw [month_start_succ, hs, hy, hmo]
  dsimp [Civil.dayIndex, dayCount]
  omega

private theorem interval_exists (f : Nat → Int) (d : Int) (n : Nat) (lo : f 0 ≤ d)
    (hi : d < f n) : ∃ k < n, f k ≤ d ∧ d < f (k + 1) := by
  induction n with
  | zero => omega
  | succ n ih =>
    by_cases h : d < f n
    · obtain ⟨k, hk, hl, hu⟩ := ih h
      exact ⟨k, by omega, hl, hu⟩
    · exact ⟨n, by omega, by omega, hi⟩

private theorem january_era (q : Int) : monthStart (400 * q * 12 + 12) = 146097 * q - 719162 := by
  have he : 400 * q * 12 + 12 = (400 * q + 1) * 12 + 1 - 1 := by omega
  rw [he, month_start_date (by decide)]
  simp [dayCount, monthPrefix]
  omega

theorem civil_decode {days : Int} (h : minI64 ≤ days ∧ days ≤ maxI64) :
    let (y, m, d) := civilFromDays days
    validDate y m d ∧ dayCount y m d = days := by
  let q := (days + 719162) / 146097
  let base := 400 * q * 12 + 12
  have hl : monthStart base ≤ days := by dsimp [base]; rw [january_era]; dsimp [q]; omega
  have hu : days < monthStart (base + 4800) := by
    have he : base + 4800 = 400 * (q + 1) * 12 + 12 := by dsimp [base]; omega
    rw [he, january_era]
    dsimp [q]
    omega
  obtain ⟨k, hk, ha, hb⟩ := interval_exists (fun k => monthStart (base + k)) days 4800
    (by simpa using hl) (by exact hu)
  let index := base + (k : Int)
  let y := index / 12
  let m := index % 12 + 1
  let d := days - monthStart index + 1
  have hb' : days < monthStart (index + 1) := by
    have he : base + (↑(k + 1) : Int) = index + 1 := by dsimp [index]; omega
    simpa only [he] using hb
  rw [month_start_succ] at hb'
  change days < monthStart index + monthLength y m at hb'
  have hc : validDate y m d := by
    change 1 ≤ m ∧ m ≤ 12 ∧ 1 ≤ d ∧ d ≤ monthLength y m
    change monthStart index ≤ days at ha
    constructor
    · dsimp [m]; omega
    constructor
    · dsimp [m]; omega
    dsimp [d]
    omega
  have hr : dayCount y m d = days := by
    dsimp [d]
    change dayCount y m (days - dayCount y m 1 + 1) = days
    dsimp [dayCount]
    omega
  have hy : minI64 ≤ y ∧ y ≤ maxI64 := by
    dsimp [y, index, base, q, minI64, maxI64] at *
    omega
  have hw := civil_round_trip_i64 hy hc
  rw [days_from_civil_spec ⟨hc.1, hc.2.1⟩, hr] at hw
  rw [hw]
  exact ⟨hc, hr⟩

end CC
