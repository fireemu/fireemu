import ClockCalendar.Gregorian

namespace CC

theorem month_step_clamps {c r : Civil} {n : Int} (h : MonthStep c n r) :
    r.monthIndex = c.monthIndex + n ∧ r.day ≤ c.day :=
  ⟨h.1, h.2.1 ▸ Int.min_le_left ..⟩

theorem anchor_idempotent {c r s : Civil} {a : Anchor} (hn : a ≠ .startOfNextMonth)
    (h : AnchorSpec c a r) (hs : AnchorSpec r a s) : s = r := by
  cases c
  cases a <;> simp [AnchorSpec] at h hs hn ⊢ <;> subst_vars <;> rfl

theorem next_month_is_start {c r s : Civil} (h : AnchorSpec c .startOfNextMonth r)
    (hs : AnchorSpec r .startOfMonth s) : s = r := by
  obtain ⟨_, hd, ht⟩ := h
  cases r
  simp [AnchorSpec] at hs
  simp_all

private theorem day_shift (y m d : Int) : dayCount y m d = dayCount y m 1 + d - 1 := by
  dsimp [dayCount]
  omega

private theorem month_start_civil {c : Civil} (h : validDate c.year c.month c.day) (hd : c.day = 1) :
    c.dayIndex = monthStart c.monthIndex := by
  unfold Civil.dayIndex
  rw [hd]
  exact (month_start_date ⟨h.1, h.2.1⟩).symm

private theorem month_end_civil {c : Civil} (h : validDate c.year c.month c.day)
    (hd : c.day = monthLength c.year c.month) :
    c.dayIndex + 1 = monthStart (c.monthIndex + 1) := by
  have hm : c.monthIndex % 12 + 1 = c.month := by unfold Civil.monthIndex; have := h.1; have := h.2.1; omega
  have hy : c.monthIndex / 12 = c.year := by unfold Civil.monthIndex; have := h.1; have := h.2.1; omega
  rw [month_start_succ, hy, hm]
  rw [show monthStart c.monthIndex = dayCount c.year c.month 1 from month_start_date ⟨h.1, h.2.1⟩]
  unfold Civil.dayIndex
  rw [day_shift, hd]
  omega

theorem day_anchor_bounds {c lo hi : Civil} (v : c.valid) (z : Int)
    (hlo : AnchorSpec c .startOfDay lo) (hhi : AnchorSpec c .endOfDay hi) :
    lo.instant z ≤ c.instant z ∧ c.instant z ≤ hi.instant z + 999 := by
  change lo = { c with nanos := 0 } at hlo
  change hi = { c with nanos := lastMicrosecond } at hhi
  subst lo
  subst hi
  have ht := v.2
  dsimp [Civil.instant, Civil.dayIndex, lastMicrosecond, nsDay] at *
  omega

private theorem bounds_of_period {c lo hi : Civil} (z : Int) (v : c.valid)
    (vl : lo.valid) (vh : hi.valid) (l : lo.monthIndex ≤ c.monthIndex) (u : c.monthIndex ≤ hi.monthIndex)
    (hl : lo.day = 1 ∧ lo.nanos = 0) (hu : hi.day = monthLength hi.year hi.month ∧ hi.nanos = lastMicrosecond) :
    lo.instant z ≤ c.instant z ∧ c.instant z ≤ hi.instant z + 999 := by
  have hb := civil_day_bounds v.1
  have hstart := month_start_civil vl.1 hl.1
  have hend := month_end_civil vh.1 hu.1
  have h₁ := month_start_mono l
  have h₂ : monthStart (c.monthIndex + 1) ≤ monthStart (hi.monthIndex + 1) := month_start_mono (by omega)
  have ht := v.2
  dsimp [Civil.instant]
  rw [hl.2, hu.2]
  unfold lastMicrosecond nsDay at *
  omega

theorem month_anchor_bounds {c lo hi : Civil} (v : c.valid) (vl : lo.valid) (vh : hi.valid) (z : Int)
    (hlo : AnchorSpec c .startOfMonth lo) (hhi : AnchorSpec c .endOfMonth hi) :
    lo.instant z ≤ c.instant z ∧ c.instant z ≤ hi.instant z + 999 := by
  change lo = { c with day := 1, nanos := 0 } at hlo
  change hi = { c with day := monthLength c.year c.month, nanos := lastMicrosecond } at hhi
  subst lo
  subst hi
  exact bounds_of_period z v vl vh (Int.le_refl _) (Int.le_refl _) ⟨rfl, rfl⟩ ⟨rfl, rfl⟩

theorem year_anchor_bounds {c lo hi : Civil} (v : c.valid) (vl : lo.valid) (vh : hi.valid) (z : Int)
    (hlo : AnchorSpec c .startOfYear lo) (hhi : AnchorSpec c .endOfYear hi) :
    lo.instant z ≤ c.instant z ∧ c.instant z ≤ hi.instant z + 999 := by
  change lo = { c with month := 1, day := 1, nanos := 0 } at hlo
  change hi = { c with month := 12, day := 31, nanos := lastMicrosecond } at hhi
  subst lo
  subst hi
  have hm := v.1.1
  have hm' := v.1.2.1
  apply bounds_of_period z v vl vh _ _ ⟨rfl, rfl⟩ ⟨by simp [monthLength], rfl⟩ <;>
    dsimp [Civil.monthIndex] <;> omega

theorem month_anchors_adjacent {c hi next : Civil} (vh : hi.valid) (vn : next.valid) (z : Int)
    (hh : AnchorSpec c .endOfMonth hi) (hn : AnchorSpec c .startOfNextMonth next) :
    hi.instant z + 1000 = next.instant z := by
  change hi = { c with day := monthLength c.year c.month, nanos := lastMicrosecond } at hh
  subst hi
  obtain ⟨hi, hd, ht⟩ := hn
  have hstart := month_start_civil vn.1 hd
  have hend := month_end_civil vh.1 rfl
  change _ + 1 = monthStart (c.monthIndex + 1) at hend
  rw [hi] at hstart
  dsimp [Civil.instant, lastMicrosecond, nsDay] at *
  rw [ht]
  omega

theorem day_anchors_adjacent {c tomorrow hi next : Civil} (z : Int)
    (hd : DayStep c 1 tomorrow) (hh : AnchorSpec c .endOfDay hi)
    (hn : AnchorSpec tomorrow .startOfDay next) : hi.instant z + 1000 = next.instant z := by
  change hi = { c with nanos := lastMicrosecond } at hh
  change next = { tomorrow with nanos := 0 } at hn
  subst hi
  subst next
  have h := hd.1
  dsimp [Civil.instant, Civil.dayIndex, lastMicrosecond, nsDay] at *
  omega

theorem month_index_eq {a b : Civil} (ha : a.valid) (hb : b.valid)
    (h : a.monthIndex = b.monthIndex) : a.year = b.year ∧ a.month = b.month := by
  have ha₁ := ha.1.1
  have ha₂ := ha.1.2.1
  have hb₁ := hb.1.1
  have hb₂ := hb.1.2.1
  unfold Civil.monthIndex at h
  omega

private theorem month_index_lt {a b : Civil} (ha : a.valid) (hb : b.valid)
    (h : a.monthIndex < b.monthIndex) : a.dayIndex < b.dayIndex := by
  have h₁ := civil_day_bounds ha.1
  have h₂ := civil_day_bounds hb.1
  have h₃ : monthStart (a.monthIndex + 1) ≤ monthStart b.monthIndex := month_start_mono (by omega)
  omega

theorem month_step_mono {a b c d : Civil} {n m : Int} (vc : c.valid) (vd : d.valid) (hidx : a.monthIndex ≤ b.monthIndex)
    (hday : a.monthIndex = b.monthIndex → a.day ≤ b.day) (hn : n ≤ m)
    (hc : MonthStep a n c) (hd : MonthStep b m d) : c.dayIndex ≤ d.dayIndex := by
  have h₁ := hc.1
  have h₂ := hd.1
  by_cases he : c.monthIndex = d.monthIndex
  · have ha : a.monthIndex = b.monthIndex := by omega
    have hle := hday ha
    have ⟨hy, hm⟩ := month_index_eq vc vd he
    have hclamp := hc.2.1
    have hdclamp := hd.2.1
    rw [hy, hm] at hclamp
    have hDays : c.day ≤ d.day := by omega
    dsimp [Civil.dayIndex]
    rw [hy, hm, day_shift d.year d.month c.day, day_shift d.year d.month d.day]
    omega
  · exact Int.le_of_lt (month_index_lt vc vd (by omega))

theorem day_step_mono {a b c d : Civil} {n m : Int} (h : a.dayIndex ≤ b.dayIndex) (hn : n ≤ m)
    (hc : DayStep a n c) (hd : DayStep b m d) : c.dayIndex ≤ d.dayIndex := by
  have h₁ := hc.1
  have h₂ := hd.1
  omega

theorem anchor_mono {a b c d : Civil} (va : a.valid) (vb : b.valid) (vc : c.valid) (vd : d.valid)
    (anchor : Anchor) (z : Int) (h : a.instant z ≤ b.instant z)
    (hc : AnchorSpec a anchor c) (hd : AnchorSpec b anchor d) : c.instant z ≤ d.instant z := by
  have hdays : a.dayIndex ≤ b.dayIndex := by
    have ha := va.2
    have hb := vb.2
    unfold Civil.instant nsDay at h
    unfold nsDay at ha hb
    omega
  have hm : a.monthIndex ≤ b.monthIndex := by
    by_cases hn : b.monthIndex < a.monthIndex
    · have := month_index_lt vb va hn
      omega
    · omega
  have hy : a.year ≤ b.year := by
    have ha₁ := va.1.1
    have ha₂ := va.1.2.1
    have hb₁ := vb.1.1
    have hb₂ := vb.1.2.1
    unfold Civil.monthIndex at hm
    omega
  have ordered (idx : c.monthIndex ≤ d.monthIndex)
      (same : c.monthIndex = d.monthIndex → c.day = d.day)
      (nanos : c.nanos = d.nanos) : c.instant z ≤ d.instant z := by
    by_cases he : c.monthIndex = d.monthIndex
    · obtain ⟨hy', hm'⟩ := month_index_eq vc vd he
      have hday := same he
      dsimp [Civil.instant, Civil.dayIndex]
      rw [hy', hm', hday, nanos]
      exact Int.le_refl _
    · have hle := month_index_lt vc vd (by omega : c.monthIndex < d.monthIndex)
      have hns : 0 < nsDay := by decide
      unfold Civil.instant nsDay at *
      omega
  cases anchor
  case startOfDay =>
    simp only [AnchorSpec] at hc hd
    subst c
    subst d
    change a.dayIndex * nsDay + 0 - z * nsSecond ≤ b.dayIndex * nsDay + 0 - z * nsSecond
    unfold nsDay
    omega
  case endOfDay =>
    simp only [AnchorSpec] at hc hd
    subst c
    subst d
    change a.dayIndex * nsDay + lastMicrosecond - z * nsSecond ≤
      b.dayIndex * nsDay + lastMicrosecond - z * nsSecond
    unfold nsDay
    omega
  case startOfNextMonth =>
    exact ordered (by have := hc.1; have := hd.1; omega) (fun _ => hc.2.1.trans hd.2.1.symm)
      (hc.2.2.trans hd.2.2.symm)
  case startOfMonth =>
    simp only [AnchorSpec] at hc hd
    subst c
    subst d
    exact ordered hm (fun _ => rfl) rfl
  case endOfMonth =>
    simp only [AnchorSpec] at hc hd
    subst c
    subst d
    refine ordered hm ?_ rfl
    intro he
    obtain ⟨hY, hM⟩ := month_index_eq va vb he
    rw [hY, hM]
  case startOfYear =>
    simp only [AnchorSpec] at hc hd
    subst c
    subst d
    exact ordered (by dsimp [Civil.monthIndex]; omega) (fun _ => rfl) rfl
  case endOfYear =>
    simp only [AnchorSpec] at hc hd
    subst c
    subst d
    exact ordered (by dsimp [Civil.monthIndex]; omega) (fun _ => rfl) rfl


theorem civil_instant_injective {a b : Civil} (va : a.valid) (vb : b.valid) {z : Int}
    (h : a.instant z = b.instant z) : a = b := by
  have ha := va.2
  have hb := vb.2
  unfold Civil.instant nsDay at h
  unfold nsDay at ha hb
  have ht : a.nanos = b.nanos := by omega
  have hd : a.dayIndex = b.dayIndex := by omega
  have hm : a.monthIndex = b.monthIndex := by
    by_cases hl : a.monthIndex < b.monthIndex
    · have := month_index_lt va vb hl
      omega
    · by_cases hu : b.monthIndex < a.monthIndex
      · have := month_index_lt vb va hu
        omega
      · omega
  obtain ⟨hy, hm⟩ := month_index_eq va vb hm
  have hday : a.day = b.day := by
    dsimp [Civil.dayIndex] at hd
    rw [hy, hm, day_shift b.year b.month a.day, day_shift b.year b.month b.day] at hd
    omega
  cases a
  cases b
  simp_all

theorem month_inverse_without_clamp {a b c : Civil} {n : Int} (va : a.valid) (vc : c.valid)
    (hday : a.day = b.day) (hf : MonthStep a n b) (hr : MonthStep b (-n) c) : c = a := by
  have hf' := hf.1
  have hr' := hr.1
  obtain ⟨hy, hm⟩ := month_index_eq vc va (by omega : c.monthIndex = a.monthIndex)
  have hd := hr.2.1
  rw [hy, hm, ← hday, Int.min_eq_left va.1.2.2.2] at hd
  have ht := hr.2.2.trans hf.2.2
  cases a
  cases c
  simp_all

theorem month_steps_agree_without_first_clamp {a b c d : Civil} {n m : Int}
    (vc : c.valid) (vd : d.valid) (hday : a.day = b.day)
    (h₁ : MonthStep a n b) (h₂ : MonthStep b m c) (h₃ : MonthStep a (n + m) d) : c = d := by
  have h₁' := h₁.1
  have h₂' := h₂.1
  have h₃' := h₃.1
  obtain ⟨hy, hm⟩ := month_index_eq vc vd (by omega : c.monthIndex = d.monthIndex)
  have hd := h₂.2.1
  rw [hy, hm, ← hday, ← h₃.2.1] at hd
  have ht := h₂.2.2.trans (h₁.2.2.trans h₃.2.2.symm)
  cases c
  cases d
  simp_all

end CC
