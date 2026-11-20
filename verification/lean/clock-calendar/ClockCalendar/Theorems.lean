import ClockCalendar.Gregorian
import ClockCalendar.Reference
import ClockCalendar.Laws

namespace CC

private theorem checked_ok {lo hi n x : Int} (h : checked lo hi n = some x) :
    x = n ∧ lo ≤ n ∧ n ≤ hi := by
  unfold checked at h
  split at h <;> simp_all

private theorem require_ok {err : Error} {o : Option α} {x : α}
    (h : require err o = .ok x) : o = some x := by
  cases o <;> simp_all [require]

private theorem bind_ok {a : Except Error α} {f : α → Except Error β} {r : β}
    (h : (a >>= f) = .ok r) : ∃ x, a = .ok x ∧ f x = .ok r := by
  cases a <;> simp_all [Bind.bind, Except.bind]

private theorem year_ok {y : Int} {u : Unit} (h : checkYear y = .ok u) :
    inYearRange y := by
  unfold checkYear at h
  split at h <;> simp_all

private theorem date_ok {y m d t : Int} {r : Civil} (h : Local.date y m d t = .ok r) :
    r = ⟨y, m, d, t⟩ ∧ inYearRange y := by
  obtain ⟨_, hy, hr⟩ := bind_ok h
  exact ⟨Except.ok.inj hr.symm, year_ok hy⟩

theorem bounds_of_civil {c : Civil} (hv : c.valid) (hy : inYearRange c.year) :
    dayCount 1 1 1 ≤ c.dayIndex ∧ c.dayIndex < dayCount 10000 1 1 := by
  have hm := hv.1
  have h := civil_day_bounds hm
  unfold validDate at hm
  unfold inYearRange at hy
  have hl : monthStart 12 ≤ monthStart c.monthIndex :=
    month_start_mono (by unfold Civil.monthIndex; omega)
  have hu : monthStart (c.monthIndex + 1) ≤ monthStart 120000 :=
    month_start_mono (by unfold Civil.monthIndex; omega)
  have h₁ : monthStart 12 = dayCount 1 1 1 := by decide
  have h₂ : monthStart 120000 = dayCount 10000 1 1 := by decide
  omega

theorem civil_range_iff {c : Civil} (hv : c.valid) (offset : Int) :
    instantInRange offset (c.instant offset) ↔ inYearRange c.year := by
  have hm := hv.1
  have h := civil_day_bounds hm
  have ht := hv.2
  unfold validDate at hm
  have h₁ : monthStart 12 = dayCount 1 1 1 := by decide
  have h₂ : monthStart 120000 = dayCount 10000 1 1 := by decide
  constructor
  · intro hr
    have hd : dayCount 1 1 1 ≤ c.dayIndex ∧ c.dayIndex < dayCount 10000 1 1 := by
      unfold instantInRange Civil.instant nsDay at hr
      unfold nsDay at ht
      omega
    unfold inYearRange
    by_cases hy : c.year < 1
    · have hl : monthStart (c.monthIndex + 1) ≤ monthStart 12 :=
        month_start_mono (by unfold Civil.monthIndex; omega)
      omega
    · by_cases hy' : c.year > 9999
      · have hu : monthStart 120000 ≤ monthStart c.monthIndex :=
          month_start_mono (by unfold Civil.monthIndex; omega)
        omega
      · omega
  · intro hy
    have hd := bounds_of_civil hv hy
    unfold instantInRange Civil.instant nsDay
    unfold nsDay at ht
    omega

private theorem triple_exists (p : Int × Int × Int) : ∃ y m d, p = (y, m, d) := by
  obtain ⟨y, m, d⟩ := p
  exact ⟨y, m, d, rfl⟩

private theorem decode_instant {t z : Int}
    (h : minI64 ≤ (t + z * nsSecond) / nsDay ∧ (t + z * nsSecond) / nsDay ≤ maxI64) :
    let w := t + z * nsSecond
    let (y, m, d) := civilFromDays (w / nsDay)
    let c : Civil := ⟨y, m, d, w % nsDay⟩
    c.valid ∧ c.instant z = t := by
  obtain ⟨y, m, d, hd⟩ := triple_exists (civilFromDays ((t + z * nsSecond) / nsDay))
  have hc := civil_decode h
  rw [hd] at hc
  obtain ⟨hv, he⟩ := hc
  dsimp only
  rw [hd]
  dsimp [Civil.valid, Civil.instant, Civil.dayIndex]
  refine ⟨⟨hv, ?_⟩, ?_⟩
  · unfold nsDay
    omega
  · rw [he]
    unfold nsDay
    omega

theorem local_of_spec {t z : Int} {r : Civil} (h : Local.of t z = .ok r) :
    r.valid ∧ inYearRange r.year ∧ r.instant z = t := by
  unfold Local.of at h
  obtain ⟨utc, hu, h⟩ := bind_ok h
  obtain ⟨wall, hw, h⟩ := bind_ok h
  obtain ⟨y, m, d, hd⟩ := triple_exists (civilFromDays (wall / 86400))
  rw [hd] at h
  obtain ⟨_, hy, hr⟩ := bind_ok h
  have hUtc := checked_ok (require_ok hu)
  have hWall := checked_ok (require_ok hw)
  have hDay : minI64 ≤ wall / 86400 ∧ wall / 86400 ≤ maxI64 := by
    unfold minI64 maxI64 at *
    omega
  have hc := civil_decode hDay
  rw [hd] at hc
  obtain ⟨hv, he⟩ := hc
  have hR : (⟨y, m, d, wall % 86400 * nsSecond + t % nsSecond⟩ : Civil) = r := Except.ok.inj hr
  subst r
  refine ⟨⟨hv, ?_⟩, year_ok hy, ?_⟩
  · dsimp
    unfold nsDay nsSecond
    omega
  · dsimp [Civil.instant, Civil.dayIndex]
    rw [he]
    unfold nsDay nsSecond at *
    omega

private theorem option_bind_ok {a : Option Int} {f : Int → Option Int} {v : Int}
    (h : a.bind f = some v) : ∃ x, a = some x ∧ f x = some v := by
  cases a <;> simp_all

theorem local_resolve_spec {c : Civil} {z t : Int} (hv : c.valid)
    (h : Local.resolve c z = .ok t) : t = c.instant z := by
  unfold Local.resolve at h
  obtain ⟨whole, hw, h⟩ := bind_ok h
  obtain ⟨wall, hl, h⟩ := bind_ok h
  obtain ⟨utc, hu, h⟩ := bind_ok h
  have h₁ := (checked_ok (require_ok hw)).1
  have h₂ := (checked_ok (require_ok hu)).1
  have hh := require_ok hl
  have ht := require_ok h
  change Option.bind _ _ = some wall at hh
  change Option.bind _ _ = some t at ht
  obtain ⟨mid, hm, hm'⟩ := option_bind_ok hh
  obtain ⟨ns, hn, hn'⟩ := option_bind_ok ht
  have h₃ := (checked_ok hm).1
  have h₄ := (checked_ok hm').1
  have h₅ := (checked_ok hn).1
  have h₆ := (checked_ok hn').1
  have hd := days_from_civil_spec (y := c.year) (d := c.day) ⟨hv.1.1, hv.1.2.1⟩
  dsimp [Civil.instant, Civil.dayIndex]
  unfold nsDay nsSecond at *
  omega

theorem month_step_spec {c r : Civil} {n : Int} (hv : c.valid) (hy : inYearRange c.year)
    (h : Local.plusMonths c n = .ok r) : r.valid ∧ inYearRange r.year ∧ MonthStep c n r := by
  unfold Local.plusMonths at h
  split at h
  · rename_i hn
    have he : c = r := Except.ok.inj h
    subst r
    exact ⟨hv, hy, by simp [MonthStep, hn, Int.min_eq_left hv.1.2.2.2]⟩
  · obtain ⟨y, hY, h⟩ := bind_ok h
    obtain ⟨_, _, h⟩ := bind_ok h
    obtain ⟨he, hy'⟩ := date_ok h
    have hz := (checked_ok (require_ok hY)).1
    let index := c.year * 12 + (c.month - 1) + n
    change y = index / 12 at hz
    have hr : 0 ≤ index % 12 ∧ index % 12 < 12 := by omega
    have hc : minI64 ≤ index % 12 ∧ index % 12 ≤ maxI64 := by
      unfold minI64 maxI64
      omega
    let m := (checked minI64 maxI64 (index % 12)).getD 0 + 1
    change r = ⟨y, m, min c.day (monthLength y m), c.nanos⟩ at he
    dsimp only [m] at he
    simp only [checked, ite_eq_left hc, Option.getD_some] at he
    subst r
    have hlen := month_length_bounds y (index % 12 + 1)
    have hd := hv.1.2.2.1
    refine ⟨⟨⟨by dsimp; omega, by dsimp; omega, ?_, Int.min_le_right ..⟩, hv.2⟩, hy', ?_⟩
    · dsimp; omega
    · refine ⟨?_, rfl, rfl⟩
      dsimp [Civil.monthIndex]
      dsimp [index] at *
      omega

theorem day_step_spec {c r : Civil} {n : Int} (hv : c.valid) (hy : inYearRange c.year)
    (h : Local.plusDays c n = .ok r) : r.valid ∧ inYearRange r.year ∧ DayStep c n r := by
  unfold Local.plusDays at h
  split at h
  · rename_i hn
    have he : c = r := Except.ok.inj h
    subst r
    exact ⟨hv, hy, by simp [DayStep, hn]⟩
  · obtain ⟨count, hc, h⟩ := bind_ok h
    have hc' := require_ok hc
    have hcount : count = n ∧ count.natAbs ≤ 4000000 := by
      unfold checked at hc'
      split at hc'
      · simp only [Option.filter_some] at hc'
        split at hc' <;> simp_all
      · simp at hc'
    obtain ⟨hcount, habs⟩ := hcount
    subst count
    let day := daysFromCivil c.year c.month c.day + n
    have hd := days_from_civil_spec (y := c.year) (d := c.day) ⟨hv.1.1, hv.1.2.1⟩
    have hb := bounds_of_civil hv hy
    have hlo : dayCount 1 1 1 = -719162 := by decide
    have hhi : dayCount 10000 1 1 = 2932897 := by decide
    have hb' : minI64 ≤ day ∧ day ≤ maxI64 := by
      dsimp only [day]
      rw [hd]
      change minI64 ≤ c.dayIndex + n ∧ c.dayIndex + n ≤ maxI64
      unfold minI64 maxI64
      omega
    obtain ⟨y, m, d, he⟩ := triple_exists (civilFromDays day)
    change (match civilFromDays day with | (y,m,d) => Local.date y m d c.nanos) = .ok r at h
    rw [he] at h
    obtain ⟨hr, hy'⟩ := date_ok h
    have hf := civil_decode hb'
    rw [he] at hf
    obtain ⟨hv', hday⟩ := hf
    subst r
    refine ⟨⟨hv', hv.2⟩, hy', ?_⟩
    exact ⟨hday.trans (congrArg (· + n) hd), rfl⟩

theorem decision_spec (kind : MoveKind) (allow : Bool) (current target : Int) :
    DecisionSpec kind allow current target (decideMove kind allow current target) := by
  cases kind <;> cases allow <;> by_cases h : current ≤ target <;>
    simp [decideMove, DecisionSpec, h] <;> omega


theorem anchor_spec {c r : Civil} {a : Anchor} (hv : c.valid)
    (h : Local.anchored c a = .ok r) : r.valid ∧ inYearRange r.year ∧ AnchorSpec c a r := by
  have hm := hv.1.1
  have hm' := hv.1.2.1
  have hd := hv.1.2.2.1
  have hd' := hv.1.2.2.2
  have hl := month_length_bounds c.year c.month
  have hz : 0 ≤ (0 : Int) ∧ (0 : Int) < nsDay := by decide
  have he : 0 ≤ lastMicrosecond ∧ lastMicrosecond < nsDay := by decide
  cases a
  case startOfNextMonth =>
    obtain ⟨m, hb, h⟩ := bind_ok h
    obtain ⟨hm0, hy⟩ := date_ok hb
    subst m
    have hv' : ({ c with day := 1, nanos := 0 } : Civil).valid :=
      ⟨⟨hm, hm', by dsimp; omega, by dsimp; omega⟩, hz⟩
    obtain ⟨hr, hyr, hstep⟩ := month_step_spec hv' hy h
    have hm1 : min 1 (monthLength r.year r.month) = 1 :=
      Int.min_eq_left (by have := month_length_bounds r.year r.month; omega)
    exact ⟨hr, hyr, hstep.1, hstep.2.1.trans hm1, hstep.2.2⟩
  all_goals
    obtain ⟨hr, hy⟩ := date_ok h
    subst r
    refine ⟨?_, hy, rfl⟩
  · exact ⟨hv.1, hz⟩
  · exact ⟨hv.1, he⟩
  · exact ⟨⟨hm, hm', by dsimp; omega, by dsimp; omega⟩, hz⟩
  · exact ⟨⟨hm, hm', by dsimp; omega, by dsimp; omega⟩, he⟩
  · exact ⟨⟨by dsimp; omega, by dsimp; omega, by dsimp; omega, by simp [monthLength]⟩, hz⟩
  · exact ⟨⟨by dsimp; omega, by dsimp; omega, by dsimp; omega, by simp [monthLength]⟩, he⟩

theorem clock_step_spec {t r : Int} {d : Duration} (h : clockPart t d = .ok r) :
    ClockStep t d.clockDelta r := by
  unfold clockPart at h
  obtain ⟨n, hn, h⟩ := bind_ok h
  obtain ⟨hours, hh, hrest⟩ := option_bind_ok (require_ok hn)
  obtain ⟨minutes, hm, hrest⟩ := option_bind_ok hrest
  obtain ⟨hmSum, hs, hrest⟩ := option_bind_ok hrest
  obtain ⟨hms, ht, hns⟩ := option_bind_ok hrest
  have hh' := (checked_ok hh).1
  have hm' := (checked_ok hm).1
  have hs' := (checked_ok hs).1
  have ht' := (checked_ok ht).1
  have hn' := (checked_ok hns).1
  have hr := (checked_ok (require_ok h)).1
  dsimp [ClockStep, Duration.clockDelta, Duration.signed]
  unfold nsSecond at *
  cases hn : d.negative <;> simp [hn] at hr ⊢ <;> omega

theorem move_clock_only {t z r : Int} {d : Duration}
    (hz : d.years = 0 ∧ d.months = 0 ∧ d.weeks = 0 ∧ d.days = 0)
    (h : moveInstant t z (some d) none = .ok r) : ClockStep t d.clockDelta r := by
  unfold moveInstant at h
  obtain ⟨clock, hc, h⟩ := bind_ok h
  have hc' : clockPart t d = .ok clock := by
    simpa [afterDuration, calendarPart, hz, Bind.bind, Except.bind, Pure.pure, Except.pure] using hc
  · obtain ⟨t', ht, h⟩ := bind_ok h
    have htc : clock = t' := by simpa [anchorPart] using ht
    subst t'
    obtain ⟨_, _, h⟩ := bind_ok h
    obtain ⟨_, _, h⟩ := bind_ok h
    have hr : clock = r := Except.ok.inj h
    subst r
    exact clock_step_spec hc'

theorem clock_inverse {t z mid r : Int} {d : Duration}
    (hz : d.years = 0 ∧ d.months = 0 ∧ d.weeks = 0 ∧ d.days = 0)
    (h₁ : moveInstant t z (some d) none = .ok mid)
    (h₂ : moveInstant mid z (some { d with negative := !d.negative }) none = .ok r) :
    r = t := by
  have h := move_clock_only hz h₁
  have h' := move_clock_only (d := { d with negative := !d.negative }) hz h₂
  unfold ClockStep at *
  dsimp [Duration.clockDelta, Duration.signed] at *
  unfold nsSecond at *
  cases hn : d.negative <;> simp [hn] at h h' <;> omega


private theorem decode_in_range {t z : Int} (h : instantInRange z t) :
    ∃ c : Civil, c.valid ∧ inYearRange c.year ∧ c.instant z = t := by
  have hl : dayCount 1 1 1 = -719162 := by decide
  have hh : dayCount 10000 1 1 = 2932897 := by decide
  have hw : minI64 ≤ (t + z * nsSecond) / nsDay ∧ (t + z * nsSecond) / nsDay ≤ maxI64 := by
    unfold instantInRange at h
    unfold minI64 maxI64 nsDay at *
    omega
  obtain ⟨y, m, d, he⟩ := triple_exists (civilFromDays ((t + z * nsSecond) / nsDay))
  have hv := decode_instant hw
  dsimp only at hv
  rw [he] at hv
  let c : Civil := ⟨y, m, d, (t + z * nsSecond) % nsDay⟩
  change c.valid ∧ c.instant z = t at hv
  have hr := (civil_range_iff hv.1 z).mp (hv.2 ▸ h)
  exact ⟨c, hv.1, hr, hv.2⟩

private theorem duration_calendar_witness {t z r : Int} {d : Duration}
    (hstart : (d.years = 0 ∧ d.months = 0 ∧ d.weeks = 0 ∧ d.days = 0) → instantInRange z t)
    (h : calendarPart t z d = .ok r) :
    ∃ a b c : Civil, a.valid ∧ b.valid ∧ c.valid ∧
      inYearRange a.year ∧ inYearRange b.year ∧ inYearRange c.year ∧
      a.instant z = t ∧ MonthStep a d.monthDelta b ∧ DayStep b d.dayDelta c ∧ c.instant z = r := by
  unfold calendarPart at h
  split at h
  · rename_i hz
    obtain ⟨a, hv, hy, ha⟩ := decode_in_range (hstart hz)
    have hr : t = r := Except.ok.inj h
    subst r
    obtain ⟨y, m, w, dd⟩ := hz
    refine ⟨a, a, a, hv, hv, hv, hy, hy, hy, ha, ?_, ?_, ha⟩
    · simp [MonthStep, Duration.monthDelta, Duration.signed, y, m, Int.min_eq_left hv.1.2.2.2]
    · simp [DayStep, Duration.dayDelta, Duration.signed, w, dd]
  · obtain ⟨months, hm, h⟩ := bind_ok h
    obtain ⟨days, hd, h⟩ := bind_ok h
    obtain ⟨a, ha, h⟩ := bind_ok h
    obtain ⟨b, hb, h⟩ := bind_ok h
    obtain ⟨c, hc, hr⟩ := bind_ok h
    obtain ⟨years, hy, hm'⟩ := option_bind_ok (require_ok hm)
    obtain ⟨weeks, hw, hd'⟩ := option_bind_ok (require_ok hd)
    have hY := (checked_ok hy).1
    have hM := (checked_ok hm').1
    have hW := (checked_ok hw).1
    have hD := (checked_ok hd').1
    have hMonth : (if d.negative then -months else months) = d.monthDelta := by
      dsimp [Duration.monthDelta, Duration.signed]
      cases hn : d.negative <;> simp <;> omega
    have hDay : (if d.negative then -days else days) = d.dayDelta := by
      dsimp [Duration.dayDelta, Duration.signed]
      cases hn : d.negative <;> simp <;> omega
    rw [hMonth] at hb
    rw [hDay] at hc
    obtain ⟨va, ya, ha⟩ := local_of_spec ha
    obtain ⟨vb, yb, hb⟩ := month_step_spec va ya hb
    obtain ⟨vc, yc, hc⟩ := day_step_spec vb yb hc
    exact ⟨a, b, c, va, vb, vc, ya, yb, yc, ha, hb, hc, (local_resolve_spec vc hr).symm⟩

private theorem anchor_witness {t z r : Int} {a : Anchor}
    (h : anchorPart t z (some a) = .ok r) :
    ∃ c d : Civil, c.valid ∧ d.valid ∧ inYearRange c.year ∧ inYearRange d.year ∧
      c.instant z = t ∧ AnchorSpec c a d ∧ d.instant z = r := by
  obtain ⟨c, hc, h⟩ := bind_ok h
  obtain ⟨d, hd, h⟩ := bind_ok h
  obtain ⟨vc, yc, hc⟩ := local_of_spec hc
  obtain ⟨vd, yd, hd⟩ := anchor_spec vc hd
  exact ⟨c, d, vc, vd, yc, yd, hc, hd, (local_resolve_spec vd h).symm⟩

private theorem move_success {t z r : Int} {d : Option Duration} {a : Option Anchor}
    (h : moveInstant t z d a = .ok r) :
    ∃ m, afterDuration t z d = .ok m ∧ anchorPart m z a = .ok r ∧ instantInRange 0 r := by
  obtain ⟨m, hm, h⟩ := bind_ok h
  obtain ⟨result, ha, h⟩ := bind_ok h
  obtain ⟨secs, hs, h⟩ := bind_ok h
  obtain ⟨_, hy, hr⟩ := bind_ok h
  have he : result = r := Except.ok.inj hr
  subst result
  have ⟨he, hLo, hHi⟩ := checked_ok (require_ok hs)
  have hdiv : (r + 0 * nsSecond) / nsDay = secs / 86400 := by
    unfold nsDay nsSecond at *
    omega
  have hday : minI64 ≤ (r + 0 * nsSecond) / nsDay ∧ (r + 0 * nsSecond) / nsDay ≤ maxI64 := by
    rw [hdiv]
    unfold minI64 maxI64 at *
    omega
  obtain ⟨y, mo, d, hd⟩ := triple_exists (civilFromDays (secs / 86400))
  have hv := decode_instant hday
  dsimp only at hv
  rw [hdiv, hd] at hv
  rw [hd] at hy
  let c : Civil := ⟨y, mo, d, (r + 0 * nsSecond) % nsDay⟩
  change c.valid ∧ c.instant 0 = r at hv
  have hc := (civil_range_iff hv.1 0).2 (year_ok hy)
  exact ⟨m, hm, ha, hv.2 ▸ hc⟩

private theorem after_duration_witness {t z m : Int} {d : Option Duration}
    (hd : afterDuration t z d = .ok m) :
    let delta := d.getD {}
    ∃ cal : Int,
      (if delta.monthDelta = 0 ∧ delta.dayDelta = 0 then cal = t else
        ∃ i j k : Civil, i.valid ∧ j.valid ∧ k.valid ∧
          inYearRange i.year ∧ inYearRange j.year ∧ inYearRange k.year ∧
          i.instant z = t ∧ MonthStep i delta.monthDelta j ∧ DayStep j delta.dayDelta k ∧ k.instant z = cal) ∧
      ClockStep cal delta.clockDelta m := by
  cases d with
  | none =>
    have hh : t = m := Except.ok.inj hd
    subst m
    exact ⟨t, by simp [Duration.monthDelta, Duration.dayDelta, Duration.signed],
      by simp [ClockStep, Duration.clockDelta, Duration.signed]⟩
  | some d =>
    obtain ⟨x, hx, hm'⟩ := bind_ok hd
    have hz : d.monthDelta = 0 ∧ d.dayDelta = 0 ↔
        d.years = 0 ∧ d.months = 0 ∧ d.weeks = 0 ∧ d.days = 0 := by
      cases hn : d.negative <;> simp [Duration.monthDelta, Duration.dayDelta, Duration.signed, hn] <;> omega
    refine ⟨x, ?_, clock_step_spec hm'⟩
    simp only [Option.getD, hz]
    split
    · rename_i hzero
      simpa [calendarPart, hzero, Pure.pure, Except.pure] using hx.symm
    · rename_i hnonzero
      exact duration_calendar_witness (fun hzero => (hnonzero hzero).elim) hx

/-- Every successful model move obeys the civil contract. -/
theorem model_sound {t z r : Int} {d : Option Duration} {a : Option Anchor}
    (h : moveInstant t z d a = .ok r) : MoveSpec t z d a r := by
  obtain ⟨m, hd, ha, hr⟩ := move_success h
  obtain ⟨cal, hc, hclock⟩ := after_duration_witness hd
  refine ⟨cal, m, hc, hclock, ?_, hr⟩
  cases a with
  | none => exact (Except.ok.inj ha).symm
  | some a => exact anchor_witness ha


private theorem calendar_out_of_range {t z r : Int} {d : Duration}
    (hrange : ¬ instantInRange z t) (h : calendarPart t z d = .ok r) : r = t := by
  unfold calendarPart at h
  split at h
  · exact Except.ok.inj h.symm
  · obtain ⟨_, _, h⟩ := bind_ok h
    obtain ⟨_, _, h⟩ := bind_ok h
    obtain ⟨i, hi, _⟩ := bind_ok h
    obtain ⟨hv, hy, he⟩ := local_of_spec hi
    have hr := (civil_range_iff hv z).2 hy
    exact False.elim (hrange (he ▸ hr))

private theorem calendar_mono {t z r s : Int} {d e : Duration}
    (hm : d.monthDelta ≤ e.monthDelta) (hd : d.dayDelta ≤ e.dayDelta)
    (h : calendarPart t z d = .ok r) (h' : calendarPart t z e = .ok s) : r ≤ s := by
  by_cases ht : instantInRange z t
  · obtain ⟨a, b, c, va, vb, vc, _, _, _, ha, hab, hbc, hr⟩ := duration_calendar_witness (fun _ => ht) h
    obtain ⟨i, j, k, vi, vj, vk, _, _, _, hi, hij, hjk, hs⟩ := duration_calendar_witness (fun _ => ht) h'
    have he := civil_instant_injective va vi (ha.trans hi.symm)
    subst i
    have hmo := month_step_mono vb vj (Int.le_refl _) (fun _ => Int.le_refl _) hm hab hij
    have hDays := day_step_mono hmo hd hbc hjk
    have hn := hbc.2.trans (hab.2.2.trans (hjk.2.trans hij.2.2).symm)
    rw [← hr, ← hs]
    unfold Civil.instant nsDay
    omega
  · rw [calendar_out_of_range ht h, calendar_out_of_range ht h']
    exact Int.le_refl _

/-- Ordering the signed deltas orders successful moves with the same start, zone and anchor. Each single unit increases exactly one of these deltas. -/
theorem move_monotone {t z r s : Int} {d e : Duration} {a : Option Anchor}
    (hm : d.monthDelta ≤ e.monthDelta) (hd : d.dayDelta ≤ e.dayDelta) (hc : d.clockDelta ≤ e.clockDelta)
    (h : moveInstant t z (some d) a = .ok r) (h' : moveInstant t z (some e) a = .ok s) : r ≤ s := by
  obtain ⟨m, hx, ha, _⟩ := move_success h
  obtain ⟨n, hy, hb, _⟩ := move_success h'
  obtain ⟨x, hx, hxm⟩ := bind_ok hx
  obtain ⟨y, hy, hyn⟩ := bind_ok hy
  have hxy := calendar_mono hm hd hx hy
  have hm' := clock_step_spec hxm
  have hn' := clock_step_spec hyn
  unfold ClockStep at hm' hn'
  have hmn : m ≤ n := by omega
  cases a with
  | none =>
    have hmr : m = r := Except.ok.inj ha
    have hns : n = s := Except.ok.inj hb
    omega
  | some a =>
    obtain ⟨i, j, vi, vj, _, _, hi, hij, hj⟩ := anchor_witness ha
    obtain ⟨k, l, vk, vl, _, _, hk, hkl, hl⟩ := anchor_witness hb
    rw [← hi, ← hk] at hmn
    rw [← hj, ← hl]
    exact anchor_mono vi vk vj vl a z hmn hij hkl

theorem model_anchor_idempotent {t z r s : Int} {a : Anchor} (hn : a ≠ .startOfNextMonth)
    (h : moveInstant t z none (some a) = .ok r)
    (h' : moveInstant r z none (some a) = .ok s) : s = r := by
  obtain ⟨m, hm, ha, _⟩ := move_success h
  obtain ⟨n, hN, hb, _⟩ := move_success h'
  have he : t = m := Except.ok.inj hm
  have he' : r = n := Except.ok.inj hN
  subst m
  subst n
  obtain ⟨i, j, _, vj, _, _, _, hij, hj⟩ := anchor_witness ha
  obtain ⟨k, l, vk, _, _, _, hk, hkl, hl⟩ := anchor_witness hb
  have hEq := civil_instant_injective vj vk (hj.trans hk.symm)
  subst k
  rw [← hl, anchor_idempotent hn hij hkl, hj]

theorem model_next_month_is_start {t z r s : Int}
    (h : moveInstant t z none (some .startOfNextMonth) = .ok r)
    (h' : moveInstant r z none (some .startOfMonth) = .ok s) : s = r := by
  obtain ⟨m, hm, ha, _⟩ := move_success h
  obtain ⟨n, hN, hb, _⟩ := move_success h'
  have he : t = m := Except.ok.inj hm
  have he' : r = n := Except.ok.inj hN
  subst m
  subst n
  obtain ⟨i, j, _, vj, _, _, _, hij, hj⟩ := anchor_witness ha
  obtain ⟨k, l, vk, _, _, _, hk, hkl, hl⟩ := anchor_witness hb
  have hEq := civil_instant_injective vj vk (hj.trans hk.symm)
  subst k
  rw [← hl, next_month_is_start hij hkl, hj]


private theorem reference_local_eq (t z : Int) : Reference.localAt t z = Local.of t z := by
  unfold Reference.localAt Local.of
  cases hs : checked minI64 maxI64 (t / nsSecond) with
  | none => rfl
  | some secs =>
    cases hw : checked minI64 maxI64 (secs + z) with
    | none => simp [hw, require, Bind.bind, Except.bind]
    | some wall =>
      have hu := (checked_ok hs).1
      have hl := (checked_ok hw).1
      have hdiv : (t + z * nsSecond) / nsDay = wall / 86400 := by
        unfold nsDay nsSecond at *
        omega
      have hrem : (t + z * nsSecond) % nsDay = wall % 86400 * nsSecond + t % nsSecond := by
        unfold nsDay nsSecond at *
        omega
      simp [hw, require, Bind.bind, Except.bind, hdiv, hrem]

private theorem reference_month_eq {c : Civil} (hv : c.valid) (hy : inYearRange c.year) (n : Int) :
    Reference.month c n = Local.plusMonths c n := by
  let i := c.monthIndex + n
  have idx : c.year * 12 + (c.month - 1) + n = i := by unfold i Civil.monthIndex; omega
  have hm := hv.1.1
  have hm' := hv.1.2.1
  have hr : minI64 ≤ i % 12 ∧ i % 12 ≤ maxI64 := by unfold minI64 maxI64; omega
  by_cases hn : n = 0
  · subst n
    have hY : c.monthIndex / 12 = c.year := by unfold Civil.monthIndex; omega
    have hM : c.monthIndex % 12 + 1 = c.month := by unfold Civil.monthIndex; omega
    simp [Reference.month, Local.plusMonths, hY, hM, checkYear, hy, Int.min_eq_left hv.1.2.2.2,
      Bind.bind, Except.bind, Pure.pure, Except.pure]
  · unfold Reference.month Local.plusMonths
    simp only [hn, ite_false, idx]
    dsimp only [i] at *
    by_cases hb : minI64 ≤ (c.monthIndex + n) / 12 ∧ (c.monthIndex + n) / 12 ≤ maxI64
    · by_cases hYear : inYearRange ((c.monthIndex + n) / 12) <;>
        simp [checked, hb, hr, require, Bind.bind, Except.bind, Local.date, checkYear, hYear]
    · have hb' : ¬ inYearRange ((c.monthIndex + n) / 12) := by
        unfold inYearRange minI64 maxI64 at *
        omega
      simp [checked, hb, require, checkYear, hb', Bind.bind, Except.bind]

private theorem reference_anchor_eq {c : Civil} (hv : c.valid) (hy : inYearRange c.year) (a : Anchor) :
    Reference.anchorAt c a = Local.anchored c a := by
  cases a
  case startOfNextMonth =>
    have hv' : ({ c with day := 1, nanos := 0 } : Civil).valid := by
      have := month_length_bounds c.year c.month
      exact ⟨⟨hv.1.1, hv.1.2.1, by dsimp; omega, by dsimp; omega⟩, by change 0 ≤ (0 : Int) ∧ (0 : Int) < nsDay; decide⟩
    simp [Reference.anchorAt, Local.anchored, Local.date, checkYear, hy, Bind.bind, Except.bind,
      Pure.pure, Except.pure]
    exact reference_month_eq hv' hy 1
  all_goals
    simp [Reference.anchorAt, Local.anchored, Local.date, checkYear, hy, Bind.bind, Except.bind,
      Pure.pure, Except.pure]

private theorem reference_resolve_spec {c : Civil} {z t : Int} (h : Reference.resolve c z = .ok t) :
    c.instant z = t := by
  obtain ⟨_, _, h⟩ := bind_ok h
  exact Except.ok.inj h

private theorem reference_calendar_witness {t z r : Int} {d : Duration}
    (hn : ¬ (d.monthDelta = 0 ∧ d.dayDelta = 0))
    (h : Reference.calendar t z d = .ok r) :
    ∃ i j k : Civil, i.valid ∧ j.valid ∧ k.valid ∧
      inYearRange i.year ∧ inYearRange j.year ∧ inYearRange k.year ∧
      i.instant z = t ∧ MonthStep i d.monthDelta j ∧ DayStep j d.dayDelta k ∧ k.instant z = r := by
  unfold Reference.calendar at h
  split at h
  · contradiction
  · obtain ⟨i, hi, h⟩ := bind_ok h
    obtain ⟨j, hj, h⟩ := bind_ok h
    obtain ⟨vi, yi, hi⟩ := local_of_spec ((reference_local_eq t z) ▸ hi)
    rw [reference_month_eq vi yi] at hj
    obtain ⟨vj, yj, hj⟩ := month_step_spec vi yi hj
    let days := j.dayIndex + d.dayDelta
    change (if days < dayCount 1 1 1 ∨ dayCount 10000 1 1 ≤ days then
      Except.error Error.yearOutOfRange else
      match civilFromDays days with | (y,m,d') => Reference.resolve ⟨y,m,d',j.nanos⟩ z) = Except.ok r at h
    split at h
    · contradiction
    · rename_i hr
      have hl : dayCount 1 1 1 = -719162 := by decide
      have hh : dayCount 10000 1 1 = 2932897 := by decide
      have hDays : minI64 ≤ days ∧ days ≤ maxI64 := by
        unfold minI64 maxI64
        omega
      obtain ⟨y, m, d', he⟩ := triple_exists (civilFromDays days)
      change (match civilFromDays days with | (y,m,d') => Reference.resolve ⟨y,m,d',j.nanos⟩ z) = .ok r at h
      rw [he] at h
      have hd := civil_decode hDays
      rw [he] at hd
      obtain ⟨hv, hCount⟩ := hd
      let k : Civil := ⟨y, m, d', j.nanos⟩
      have vk : k.valid := ⟨hv, vj.2⟩
      have hv' : instantInRange z (k.instant z) := by
        unfold instantInRange Civil.instant
        change dayCount 1 1 1 * nsDay ≤ dayCount y m d' * nsDay + _ - _ + _ ∧
          dayCount y m d' * nsDay + _ - _ + _ < dayCount 10000 1 1 * nsDay
        rw [hCount]
        have hn := vj.2
        dsimp [k]
        unfold nsDay at *
        omega
      exact ⟨i, j, k, vi, vj, vk, yi, yj, (civil_range_iff vk z).1 hv', hi, hj,
        ⟨hCount, rfl⟩, reference_resolve_spec h⟩

theorem reference_sound {t z r : Int} {d : Option Duration} {a : Option Anchor}
    (h : referenceMove t z d a = .ok r) : MoveSpec t z d a r := by
  unfold referenceMove at h
  dsimp only at h
  obtain ⟨cal, hcal, h⟩ := bind_ok h
  obtain ⟨clock, hclock, h⟩ := bind_ok h
  obtain ⟨result, hanchor, h⟩ := bind_ok h
  split at h
  · rename_i hr
    have he : result = r := Except.ok.inj h
    subst result
    refine ⟨cal, clock, ?_, (checked_ok (require_ok hclock)).1, ?_, hr⟩
    · split
      · rename_i hz
        simpa [Reference.calendar, hz] using hcal.symm
      · rename_i hn
        exact reference_calendar_witness hn hcal
    · cases a with
      | none => exact (Except.ok.inj hanchor).symm
      | some a =>
        obtain ⟨l, hl, h⟩ := bind_ok hanchor
        rw [reference_local_eq] at hl
        obtain ⟨vl, yl, hl⟩ := local_of_spec hl
        obtain ⟨q, hq, h⟩ := bind_ok h
        rw [reference_anchor_eq vl yl] at hq
        obtain ⟨vq, yq, hq⟩ := anchor_spec vl hq
        exact ⟨l, q, vl, vq, yl, yq, hl, hq, reference_resolve_spec h⟩
  · contradiction


private theorem duration_spec_unique {i j k i' j' k' : Civil} {x z c c' : Int} {d : Duration}
    (vi : i.valid) (vj : j.valid) (vi' : i'.valid) (vj' : j'.valid)
    (hi : i.instant z = x) (hi' : i'.instant z = x)
    (hj : MonthStep i d.monthDelta j) (hj' : MonthStep i' d.monthDelta j')
    (hk : DayStep j d.dayDelta k) (hk' : DayStep j' d.dayDelta k')
    (hc : ClockStep (k.instant z) d.clockDelta c) (hc' : ClockStep (k'.instant z) d.clockDelta c') :
    c = c' := by
  have hi_eq := civil_instant_injective vi vi' (hi.trans hi'.symm)
  subst i'
  have hIndex := hj.1.trans hj'.1.symm
  obtain ⟨hYear, hMonth⟩ := month_index_eq vj vj' hIndex
  have hDay : j.day = j'.day := by rw [hj.2.1, hj'.2.1, hYear, hMonth]
  have hJDay : j.dayIndex = j'.dayIndex := by dsimp [Civil.dayIndex]; rw [hYear, hMonth, hDay]
  have hKDay := hk.1.trans (congrArg (· + d.dayDelta) hJDay) |>.trans hk'.1.symm
  have hTime := hk.2.trans (hj.2.2.trans (hk'.2.trans hj'.2.2).symm)
  have hInst : k.instant z = k'.instant z := by unfold Civil.instant; rw [hKDay, hTime]
  exact hc.trans ((congrArg (· + d.clockDelta) hInst).trans hc'.symm)

theorem move_spec_unique {t z r s : Int} {d : Option Duration} {a : Option Anchor}
    (h : MoveSpec t z d a r) (h' : MoveSpec t z d a s) : r = s := by
  obtain ⟨cal, x, hcal, hx, ha, _⟩ := h
  obtain ⟨cal', x', hcal', hx', ha', _⟩ := h'
  have hxEq : x = x' := by
    by_cases hz : (d.getD {}).monthDelta = 0 ∧ (d.getD {}).dayDelta = 0
    · simp only [ite_eq_left hz] at hcal hcal'
      rw [hcal] at hx
      rw [hcal'] at hx'
      exact hx.trans hx'.symm
    · simp only [ite_eq_right hz] at hcal hcal'
      obtain ⟨i, j, k, vi, vj, _, _, _, _, hi, hj, hk, he⟩ := hcal
      obtain ⟨i', j', k', vi', vj', _, _, _, _, hi', hj', hk', he'⟩ := hcal'
      rw [← he] at hx
      rw [← he'] at hx'
      exact duration_spec_unique vi vj vi' vj' hi hi' hj hj' hk hk' hx hx'
  rw [← hxEq] at ha'
  cases a with
  | none => exact ha.trans ha'.symm
  | some a =>
    obtain ⟨m, n, vm, vn, _, _, hm, hn, hr⟩ := ha
    obtain ⟨m', n', vm', vn', _, _, hm', hn', hs⟩ := ha'
    have hmEq := civil_instant_injective vm vm' (hm.trans hm'.symm)
    subst m'
    have hnEq : n = n' := by
      cases a <;> simp only [AnchorSpec] at hn hn'
      all_goals first
        | exact hn.trans hn'.symm
        | obtain ⟨hy, hm⟩ := month_index_eq vn vn' (hn.1.trans hn'.1.symm)
          have hd := hn.2.1.trans hn'.2.1.symm
          have ht := hn.2.2.trans hn'.2.2.symm
          cases n
          cases n'
          simp_all
    subst n'
    exact hr.symm.trans hs

theorem model_reference_agree {t z r s : Int} {d : Option Duration} {a : Option Anchor}
    (h : moveInstant t z d a = .ok r)
    (h' : referenceMove t z d a = .ok s) : r = s :=
  move_spec_unique (model_sound h) (reference_sound h')

end CC
