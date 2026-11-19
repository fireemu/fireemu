import VirtualClock.Laws

/-!
# Properties of the virtual clock

Every theorem quantifies over all states that satisfy `WF` (which every initial state does and
every step keeps) and over all readings, wall instants and operations. A `none` step (a panic)
satisfies every theorem vacuously; where the Rust code panics is stated in `Spec.lean`.

"The instant now" is the instant a read at reading `r` shows (`sampleAt s r`); it depends on the
reading for a following clock. Properties across one operation compare the reads before and
after it at the same reading, which is what the operation saw.
-/

namespace VC

/-! ## The invariant -/

theorem wf_init (i : Init) (wall : Bool)
    (h : fits (match i with | .new t | .paused t | .following t _ => t) = true) :
    WF (i.state wall) := by
  cases i <;> simp_all [Init.state, WF, u128Max, u64Max, u32Max, i128Max]

theorem wf_step {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s) (hop : op.Fits w)
    (h : step s r w op = some (res, s')) : WF s' := by
  rcases step_shape hw hop h with rfl | ⟨sm, hs⟩ | ⟨sm, s1, lo, hi, hs, rfl, _, hlo, hhi, _⟩ |
      ⟨sm, s1, inst, hs, hc, P, _⟩
  · exact hw
  · exact (sample_facts hw hs).wf
  · have F := sample_facts hw hs
    obtain ⟨a1, a2, a3, a4, a5, a6, a7, a8, _⟩ := F.wf
    refine ⟨a1, a2, a3, a4, a5, a6, a7, a8, fun mn mx hm => ?_⟩
    simp only [Option.some.injEq, Prod.mk.injEq] at hm
    obtain ⟨rfl, rfl⟩ := hm
    have := F.ge_now; have := F.now; simp only at *; omega
  · exact P.wf

/-! ## A frozen clock stands still -/

/-- A frozen clock shows its last move at every reading, and reading it changes nothing. -/
theorem frozen_read {s s1 : St} {r : Int} {sm : Sample} (hw : WF s) (hf : s.following = false)
    (h : sampleAt s r = some (sm, s1)) : sm.instant = s.now ∧ s1 = s :=
  ⟨((sample_facts hw h).frozen hf).2.1, ((sample_facts hw h).frozen hf).1⟩

/-- An operation that does not name an instant keeps the instant a read shows. -/
theorem non_setter_keeps_read {s s' s1 : St} {r w : Int} {op : Op} {res : Res} {sm : Sample}
    (hw : WF s) (hop : op.Fits w) (hn : op.setsInstant = false)
    (h : step s r w op = some (res, s')) (hs : sampleAt s r = some (sm, s1)) :
    ∃ sm' s1', sampleAt s' r = some (sm', s1') ∧ sm'.instant = sm.instant := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _, hlo, hhi, hnar⟩ |
      ⟨sm0, s0, inst, h0, _, P, _, _, _, hst, _⟩
  · exact ⟨sm, s1, hs, rfl⟩
  · obtain ⟨rfl, rfl⟩ := sample_some h0 hs
    exact ⟨_, _, (sample_facts hw hs).idem, rfl⟩
  · obtain ⟨rfl, rfl⟩ := sample_some h0 hs
    exact ⟨_, _, restrict_live hw hs hlo hhi (fun mn mx hm => (hnar mn mx hm).2), rfl⟩
  · obtain ⟨rfl, rfl⟩ := sample_some h0 hs
    exact ⟨_, _, P.fresh, hst hn⟩

/-- A frozen clock's instant does not change without an operation that sets it. -/
theorem frozen_stands_still {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hop : op.Fits w) (hf : s.following = false) (hn : op.setsInstant = false)
    (h : step s r w op = some (res, s')) : s'.now = s.now := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _⟩ |
      ⟨sm0, s0, inst, h0, _, P, _, _, _, hst, _⟩
  · rfl
  · exact (sample_facts hw h0).now
  · exact (sample_facts hw h0).now
  · rw [P.now, hst hn]; exact ((sample_facts hw h0).frozen hf).2.1

/-! ## The instant never goes back uncounted -/

/-- Across one operation, the instant a read shows never decreases, except by an operation that
allows it, and then the rewind is counted. -/
theorem never_backwards_uncounted {s s' s1 s1' : St} {r w : Int} {op : Op} {res : Res}
    {sm sm' : Sample} (hw : WF s) (hop : op.Fits w) (h : step s r w op = some (res, s'))
    (hs : sampleAt s r = some (sm, s1)) (hs' : sampleAt s' r = some (sm', s1')) :
    sm.instant ≤ sm'.instant ∨
      (op.allowsBackwards = true ∧ sm'.instant < sm.instant ∧
        s'.backwardsSets = satU32 (s.backwardsSets + 1)) := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _, hlo, hhi, hnar⟩ |
      ⟨sm0, s0, inst, h0, _, P, hb, ha, _⟩
  · obtain ⟨rfl, rfl⟩ := sample_some hs hs'; omega
  · obtain ⟨rfl, rfl⟩ := sample_some h0 hs
    obtain ⟨rfl, rfl⟩ := sample_some (sample_facts hw hs).idem hs'; omega
  · obtain ⟨rfl, rfl⟩ := sample_some h0 hs
    obtain ⟨rfl, rfl⟩ :=
      sample_some (restrict_live hw hs hlo hhi (fun mn mx hm => (hnar mn mx hm).2)) hs'
    left; simp
  · obtain ⟨rfl, rfl⟩ := sample_some h0 hs
    obtain ⟨rfl, rfl⟩ := sample_some P.fresh hs'
    by_cases hlt : inst < sm.instant
    · right; exact ⟨ha hlt, hlt, by rw [hb]; simp [hlt]⟩
    · left; simp only; omega

/-- Between operations, a later read never shows an earlier instant, as long as the drift it
adds does not overflow `i128` (see `read_steps_back_at_the_i128_top` for what happens when it
does). The readings themselves may go back: the high-water mark holds the clock. -/
theorem reads_never_go_back {s s1 s2 : St} {r1 r2 : Int} {sm1 sm2 : Sample} (hw : WF s)
    (h1 : sampleAt s r1 = some (sm1, s1)) (h2 : sampleAt s1 r2 = some (sm2, s2))
    (hno : s.now + sm2.drift ≤ i128Max) : sm1.instant ≤ sm2.instant := by
  have F1 := sample_facts hw h1
  have F2 := sample_facts F1.wf h2
  have hd : sm1.drift ≤ sm2.drift := by
    cases hm : s.mode with
    | following a p =>
      exact (F2.mode_following a sm1.drift (F1.mode_following a p hm).1).2.2
    | noSource | frozen =>
      have := (F1.frozen (by simp [St.following, hm])).2.2; have := F2.drift_nonneg; omega
  have e2 := F2.exact_clamped (by rw [F1.now]; exact hno)
  have u1 := F1.le_drift
  have m1 := F1.le_max
  rw [F1.now, F1.range] at e2
  cases hrg : s.range with
  | none => simp [hrg, clampMax] at e2; omega
  | some b =>
    obtain ⟨mn, mx⟩ := b
    have := m1 mn mx hrg
    simp [hrg, clampMax] at e2; omega

/-- The property above is false without its hypothesis: a following clock close to the top of
the `i128` range shows an earlier instant once the drift overflows, because `sample_at` falls
back to the last published instant instead of saturating. Nothing counts this step back. -/
theorem read_steps_back_at_the_i128_top :
    let s : St := ⟨i128Max - 10, .following 0 0, false, 0, 0, 0, none⟩
    (sampleAt s 5).map (·.1.instant) = some (i128Max - 5) ∧
      ((sampleAt s 5).bind (fun p => sampleAt p.2 20)).map (·.1.instant) = some (i128Max - 10) := by
  decide

/-! ## A refused operation changes nothing -/

/-- A refused operation (an error, a sync that publishes nothing, a wall resume without a wall
reading) changes nothing except the high-water mark that its own read of the source moves,
exactly as a read on its own would. -/
theorem refused_changes_nothing {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hop : op.Fits w) (h : step s r w op = some (res, s')) (hr : res.refused = true) :
    s' = s ∨ ∃ sm, sampleAt s r = some (sm, s') := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, hu, _⟩ |
      ⟨sm0, s0, inst, h0, _, P, _, _, hrf, _⟩
  · exact .inl rfl
  · exact .inr ⟨sm0, h0⟩
  · rw [hu] at hr; simp [Res.refused] at hr
  · rw [hrf] at hr; cases hr

/-- What the replay test observes is unchanged by a refused operation. -/
theorem refused_keeps_observation {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hop : op.Fits w) (h : step s r w op = some (res, s')) (hr : res.refused = true) :
    s'.now = s.now ∧ s'.elapsed = s.elapsed ∧ s'.revision = s.revision ∧
      s'.backwardsSets = s.backwardsSets ∧ s'.range = s.range ∧ s'.following = s.following ∧
      ∀ sm s1, sampleAt s r = some (sm, s1) → ∃ s2, sampleAt s' r = some (sm, s2) := by
  rcases refused_changes_nothing hw hop h hr with rfl | ⟨sm, hs⟩
  · exact ⟨rfl, rfl, rfl, rfl, rfl, rfl, fun sm s1 h1 => ⟨s1, h1⟩⟩
  · have F := sample_facts hw hs
    refine ⟨F.now, F.elapsed, F.revision, F.back, F.range, F.following, fun sm1 s1 h1 => ?_⟩
    obtain ⟨rfl, rfl⟩ := sample_some hs h1
    exact ⟨_, F.idem⟩

/-! ## Freeze and resume -/

/-- Freezing and resuming at the same reading keeps the instant now. -/
theorem freeze_then_resume_keeps_the_instant {s s1 s2 x : St} {r w : Int} {a b : Res} {sm : Sample}
    (hw : WF s) (h1 : step s r w .freeze = some (a, s1)) (h2 : step s1 r w .resume = some (b, s2))
    (hs : sampleAt s r = some (sm, x)) :
    ∃ sm2 x2, sampleAt s2 r = some (sm2, x2) ∧ sm2.instant = sm.instant := by
  obtain ⟨sm1, x1, hs1, e1⟩ := non_setter_keeps_read hw (show Op.Fits w .freeze from trivial) rfl h1 hs
  obtain ⟨sm2, x2, hs2, e2⟩ := non_setter_keeps_read (wf_step hw (show Op.Fits w .freeze from trivial) h1)
    (show Op.Fits w .resume from trivial) rfl h2 hs1
  exact ⟨sm2, x2, hs2, by rw [e2, e1]⟩

theorem freeze_idempotent {s s1 : St} {r w : Int} {a : Res} (hw : WF s)
    (h : step s r w .freeze = some (a, s1)) : step s1 r w .freeze = some (a, s1) := by
  simp only [step] at h ⊢
  cases hm : s.mode with
  | noSource | frozen =>
    simp only [hm, Option.some.injEq, Prod.mk.injEq] at h
    obtain ⟨rfl, rfl⟩ := h
    simp [hm]
  | following an p =>
    simp only [hm] at h
    cases hs : sampleAt s r with
    | none => simp [hs] at h
    | some q =>
      obtain ⟨sm, s0⟩ := q
      have F := sample_facts hw hs
      simp only [hs] at h
      cases hc : check s0 sm.instant sm with
      | some e =>
        simp only [hc, Option.some.injEq, Prod.mk.injEq] at h
        obtain ⟨rfl, rfl⟩ := h
        rw [(F.mode_following an p hm).1]
        simp [F.idem, hc]
      | none =>
        simp only [hc] at h
        cases hp : publish { s0 with mode := .frozen } sm.instant sm r with
        | none => simp [hp] at h
        | some s2 =>
          simp only [hp, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          obtain ⟨_, _, _, _, _, hb0, hb1, _, _⟩ := F.wf
          have P := pubOut_of (s2 := { s0 with mode := .frozen }) hw hs hc F.fits_instant
            ⟨rfl, rfl, rfl, rfl, rfl, hb0, hb1, fun a p hm => by cases hm⟩ hp
          have hm2 := P.2.2.2 rfl
          simp only at hm2
          simp [hm2]

theorem resume_idempotent {s s1 : St} {r w : Int} {a : Res} (hw : WF s)
    (h : step s r w .resume = some (a, s1)) : step s1 r w .resume = some (a, s1) := by
  simp only [step] at h ⊢
  cases hm : s.mode with
  | following an p =>
    simp only [hm, Option.some.injEq, Prod.mk.injEq] at h
    obtain ⟨rfl, rfl⟩ := h
    simp [hm]
  | noSource | frozen =>
    simp only [hm] at h
    rcases resumeTo_cases hw hw.1 (by simp) h with ⟨rfl, rfl⟩ | ⟨sm, e, hs, rfl⟩ |
        ⟨sm, s0, hs, hc, rfl, _, _, P, hf⟩
    · simp only [hm]; exact h
    · obtain ⟨rfl, _⟩ := (sample_facts hw hs).frozen (by simp [St.following, hm])
      simp only [hm]; exact h
    · cases hm1 : s1.mode with
      | following _ _ => rfl
      | noSource | frozen => simp [St.following, hm1] at hf

/-! ## The range -/

/-- Every published instant is inside the configured range. -/
theorem published_in_range {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hop : op.Fits w) (h : step s r w op = some (res, s')) (hrev : s'.revision ≠ s.revision) :
    InRange s'.range s'.now := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _⟩ |
      ⟨sm0, s0, inst, h0, hc, P, _⟩
  · exact absurd rfl hrev
  · exact absurd (sample_facts hw h0).revision hrev
  · exact absurd (sample_facts hw h0).revision hrev
  · rw [P.range, P.now, ← (sample_facts hw h0).range]; exact (check_none hc).2.1

def peakOf : Mode → Int
  | .following _ p => p
  | _ => 0

/-- What keeps reads above the range minimum: the last published instant plus the high-water
mark is at least the minimum. -/
def ReadFloor (s : St) : Prop :=
  ∀ mn mx, s.range = some (mn, mx) → mn ≤ mx ∧ mn ≤ s.now + peakOf s.mode

theorem readFloor_init (i : Init) (wall : Bool) : ReadFloor (i.state wall) := by
  cases i <;> simp [ReadFloor, Init.state]

theorem readFloor_step {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hfl : ReadFloor s) (hop : op.Fits w) (h : step s r w op = some (res, s')) : ReadFloor s' := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _, hlo, hhi, _⟩ |
      ⟨sm0, s0, inst, h0, hc, P, _⟩
  · exact hfl
  · have F := sample_facts hw h0
    intro mn mx hm
    rw [F.range] at hm
    have := hfl mn mx hm
    rw [F.now]
    cases hmo : s.mode with
    | following a p =>
      rw [(F.mode_following a p hmo).1]
      have := (F.mode_following a p hmo).2.2
      simp only [peakOf, hmo] at *; omega
    | noSource | frozen =>
      rw [F.mode_other (by simp [St.following, hmo]), hmo]
      simp only [peakOf, hmo] at *; omega
  · have F := sample_facts hw h0
    intro mn mx hm
    simp only [Option.some.injEq, Prod.mk.injEq] at hm
    obtain ⟨rfl, rfl⟩ := hm
    have := F.le_drift
    simp only
    rw [F.now]
    cases hmo : s.mode with
    | following a p =>
      rw [(F.mode_following a p hmo).1]; simp only [peakOf]; omega
    | noSource | frozen =>
      rw [F.mode_other (by simp [St.following, hmo]), hmo]
      have := ((F.frozen (by simp [St.following, hmo])).2.2)
      simp only [peakOf]; omega
  · intro mn mx hm
    have hrg : s.range = some (mn, mx) := by rw [← P.range]; exact hm
    have := (hfl mn mx hrg).1
    have hin := (check_none hc).2.1 mn mx (by rw [(sample_facts hw h0).range]; exact hrg)
    have hp : 0 ≤ peakOf s'.mode := by
      obtain ⟨_, _, _, _, _, _, _, hpk, _⟩ := P.wf
      cases hmo : s'.mode with
      | following a p => exact (hpk a p hmo).1
      | noSource | frozen => simp [peakOf]
    rw [P.now]; omega

/-- A read is inside the range when its drift does not overflow `i128`. -/
theorem read_in_range {s s1 : St} {r : Int} {sm : Sample} (hw : WF s) (hfl : ReadFloor s)
    (h : sampleAt s r = some (sm, s1)) (hno : s.now + sm.drift ≤ i128Max) :
    InRange s.range sm.instant := by
  have F := sample_facts hw h
  have e := F.exact_clamped hno
  have hpd : peakOf s.mode ≤ sm.drift := by
    cases hmo : s.mode with
    | following a p => exact (F.mode_following a p hmo).2.2
    | noSource | frozen => simp [peakOf]; exact F.drift_nonneg
  intro mn mx hm
  have := hfl mn mx hm
  rw [hm] at e; simp [clampMax] at e; omega

/-- Without the hypothesis a read can show an instant below the range minimum: a range set while
the clock reads later than its last publication, then a drift that overflows `i128`. -/
theorem read_below_the_range_minimum :
    let s : St := ⟨10, .following 0 0, false, 0, 0, 0, none⟩
    ((step s 10 0 (.restrictRange 15 100)).bind (fun p => sampleAt p.2 i128Max)).map
      (·.1.instant) = some 10 := by
  decide

/-! ## The publication budget -/

theorem budget_monotone {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hop : op.Fits w) (h : step s r w op = some (res, s')) :
    s.elapsed ≤ s'.elapsed ∧ s.revision ≤ s'.revision ∧ s.backwardsSets ≤ s'.backwardsSets := by
  have ⟨_, he0, he1, _, _, hb0, hb1, _, _⟩ := hw
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _⟩ |
      ⟨sm0, s0, inst, h0, hc, P, hb, _⟩
  · omega
  · have F := sample_facts hw h0; rw [F.elapsed, F.revision, F.back]; omega
  · have F := sample_facts hw h0; simp only; rw [F.elapsed, F.revision, F.back]; omega
  · have F := sample_facts hw h0
    have := F.counted; have := F.ge_now
    rw [P.elapsed, P.revision, hb]
    simp only [elapsedAfter, satU128, satU32, u128Max, u32Max] at *
    refine ⟨?_, by omega, ?_⟩ <;> (repeat' split) <;> omega

/-- At the last revision every operation is refused: nothing is published. -/
theorem last_revision_refuses {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hop : op.Fits w) (h : step s r w op = some (res, s')) (hmax : s.revision = u64Max) :
    s'.now = s.now ∧ s'.elapsed = s.elapsed ∧ s'.revision = s.revision ∧
      s'.backwardsSets = s.backwardsSets := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _⟩ |
      ⟨sm0, s0, inst, h0, hc, P, _⟩
  · exact ⟨rfl, rfl, rfl, rfl⟩
  · have F := sample_facts hw h0; exact ⟨F.now, F.elapsed, F.revision, F.back⟩
  · have F := sample_facts hw h0; exact ⟨F.now, F.elapsed, F.revision, F.back⟩
  · exact absurd hmax P.not_max

/-- Every publication fits the elapsed budget, and the forward move it publishes is counted in
full (only the drift folded in with it saturates). -/
theorem publication_within_budget {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s)
    (hop : op.Fits w) (h : step s r w op = some (res, s')) (hrev : s'.revision ≠ s.revision) :
    ∃ sm s1, sampleAt s r = some (sm, s1) ∧
      (s'.now > sm.instant →
        s'.elapsed = satU128 (s.elapsed + sm.counted) + (s'.now - sm.instant) ∧
          s'.elapsed ≤ u128Max) ∧
      (s'.now ≤ sm.instant → s'.elapsed = satU128 (s.elapsed + sm.counted)) := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _⟩ |
      ⟨sm0, s0, inst, h0, hc, P, _⟩
  · exact absurd rfl hrev
  · exact absurd (sample_facts hw h0).revision hrev
  · exact absurd (sample_facts hw h0).revision hrev
  · refine ⟨sm0, s0, h0, fun hg => ?_, fun hl => ?_⟩
    · rw [P.now] at hg ⊢
      have := P.budget hg
      rw [P.elapsed]; simp only [elapsedAfter, satU128] at *
      simp only [hg, ↓reduceIte]; omega
    · rw [P.now] at hl
      rw [P.elapsed]; simp only [elapsedAfter]
      have : ¬ inst > sm0.instant := by omega
      simp only [this, ↓reduceIte]

/-- A move to an instant whose forward distance does not fit the elapsed budget is refused. -/
theorem over_budget_refused {s s' s1 : St} {r w i : Int} {op : Op} {res : Res} {sm : Sample}
    (hw : WF s) (hop : op.Fits w) (h : step s r w op = some (res, s')) (ht : op.target = some i)
    (hs : sampleAt s r = some (sm, s1)) (hg : i > sm.instant)
    (hover : satU128 (s.elapsed + sm.counted) + (i - sm.instant) > u128Max) :
    s'.now = s.now ∧ s'.revision = s.revision ∧ s'.elapsed = s.elapsed := by
  rcases step_shape hw hop h with rfl | ⟨sm0, h0⟩ | ⟨sm0, s0, lo, hi, h0, rfl, _⟩ |
      ⟨sm0, s0, inst, h0, hc, P, _, _, _, _, htg⟩
  · exact ⟨rfl, rfl, rfl⟩
  · have F := sample_facts hw h0; exact ⟨F.now, F.revision, F.elapsed⟩
  · have F := sample_facts hw h0; exact ⟨F.now, F.revision, F.elapsed⟩
  · obtain ⟨rfl, rfl⟩ := sample_some h0 hs
    have := htg i ht; subst this
    have := P.budget hg; omega

end VC
