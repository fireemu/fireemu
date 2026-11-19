import VirtualClock.Spec

set_option linter.unusedSimpArgs false

/-!
# Lemmas about one sample and one publication
-/

namespace VC

/-- Case-split every `if` in the goal and close the arithmetic. -/
macro "vc_omega" : tactic =>
  `(tactic| ((repeat' split) <;> (try simp_all [i128Min, i128Max, u128Max, u64Max, u32Max, satU128, satU64, satU32]) <;> omega))

theorem fits_iff (x : Int) : fits x = true ↔ i128Min ≤ x ∧ x ≤ i128Max := by
  simp [fits]

/-- The state invariant: every field is representable, the high-water mark is a drift, and the
last published instant is at most the range maximum. (It can be below the range minimum: a range
can be set while the clock reads later than its last publication.) -/
def WF (s : St) : Prop :=
  fits s.now = true ∧ 0 ≤ s.elapsed ∧ s.elapsed ≤ u128Max ∧ 0 ≤ s.revision ∧
    s.revision ≤ u64Max ∧ 0 ≤ s.backwardsSets ∧ s.backwardsSets ≤ u32Max ∧
    (∀ a p, s.mode = .following a p → 0 ≤ p ∧ p ≤ i128Max) ∧
    (∀ mn mx, s.range = some (mn, mx) → s.now ≤ mx)

def InRange (rg : Option (Int × Int)) (x : Int) : Prop :=
  ∀ mn mx, rg = some (mn, mx) → mn ≤ x ∧ x ≤ mx

/-- What one sample does. -/
structure SampleFacts (s : St) (r : Int) (sm : Sample) (s1 : St) : Prop where
  now : s1.now = s.now
  wall : s1.wall = s.wall
  back : s1.backwardsSets = s.backwardsSets
  elapsed : s1.elapsed = s.elapsed
  revision : s1.revision = s.revision
  range : s1.range = s.range
  following : s1.following = s.following
  wf : WF s1
  ge_now : s.now ≤ sm.instant
  fits_instant : fits sm.instant = true
  le_max : ∀ mn mx, s.range = some (mn, mx) → sm.instant ≤ mx
  counted : sm.counted = sm.instant - s.now
  le_drift : sm.instant ≤ s.now + sm.drift
  exact_clamped : s.now + sm.drift ≤ i128Max → sm.instant = clampMax s.range (s.now + sm.drift)
  drift_nonneg : 0 ≤ sm.drift
  idem : sampleAt s1 r = some (sm, s1)
  frozen : s.following = false → s1 = s ∧ sm.instant = s.now ∧ sm.drift = 0
  mode_following : ∀ a p, s.mode = .following a p →
    s1.mode = .following a sm.drift ∧ r - a ≤ sm.drift ∧ p ≤ sm.drift
  mode_other : s.following = false → s1.mode = s.mode

theorem sample_facts {s : St} {r : Int} {sm : Sample} {s1 : St} (hw : WF s)
    (h : sampleAt s r = some (sm, s1)) : SampleFacts s r sm s1 := by
  obtain ⟨now, mode, wall, back, el, rev, rg⟩ := s
  obtain ⟨hn, he0, he1, hr0, hr1, hb0, hb1, hp, hrg⟩ := hw
  simp only at hn he0 he1 hr0 hr1 hb0 hb1 hp hrg
  rw [fits_iff] at hn
  unfold sampleAt at h
  cases mode with
  | following a p =>
    have hp' := hp a p rfl
    by_cases hf : fits (r - a) = true
    · simp only [hf, ite_true, Option.some.injEq, Prod.mk.injEq] at h
      obtain ⟨rfl, rfl⟩ := h
      rw [fits_iff] at hf
      cases rg with
      | none =>
        constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt] <;> vc_omega
      | some b =>
        obtain ⟨mn, mx⟩ := b
        constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt] <;> vc_omega
    · simp [hf] at h
  | noSource | frozen =>
    simp only [Option.some.injEq, Prod.mk.injEq] at h
    obtain ⟨rfl, rfl⟩ := h
    cases rg with
    | none => constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt] <;> vc_omega
    | some b =>
      obtain ⟨mn, mx⟩ := b
      constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt] <;> vc_omega

/-- The elapsed budget after a publication of `instant` from sample `sm`. -/
def elapsedAfter (e : Int) (sm : Sample) (instant : Int) : Int :=
  let e1 := satU128 (e + sm.counted)
  if instant > sm.instant then satU128 (e1 + (instant - sm.instant)) else e1

/-- What one publication does. The anchor condition holds after a sample (the drift is at least
the reading's distance from the anchor) and after a resume (the anchor is set from the reading). -/
structure PublishFacts (s : St) (instant r : Int) (sm : Sample) (s' : St) : Prop where
  now : s'.now = instant
  wall : s'.wall = s.wall
  back : s'.backwardsSets = s.backwardsSets
  range : s'.range = s.range
  revision : s'.revision = s.revision + 1
  elapsed : s'.elapsed = elapsedAfter s.elapsed sm instant
  following : s'.following = s.following
  wf : WF s'
  fresh : sampleAt s' r = some (⟨instant, 0, 0⟩, s')
  mode_following : ∀ a p, s.mode = .following a p → s'.mode = .following (a + sm.drift) 0
  mode_other : s.following = false → s'.mode = s.mode

theorem publish_facts {s : St} {instant r : Int} {sm : Sample} {s' : St}
    (hw : WF s) (hi : fits instant = true) (hrg : InRange s.range instant)
    (hrev : s.revision ≠ u64Max) (hc : 0 ≤ sm.counted)
    (ha : ∀ a p, s.mode = .following a p → r - a ≤ sm.drift)
    (h : publish s instant sm r = some s') : PublishFacts s instant r sm s' := by
  obtain ⟨now, mode, wall, back, el, rev, rg⟩ := s
  obtain ⟨hn, he0, he1, hr0, hr1, hb0, hb1, hp, hrg'⟩ := hw
  simp only at hn he0 he1 hr0 hr1 hb0 hb1 hp hrg' hrev ha hrg
  rw [fits_iff] at hn hi
  cases mode with
  | following a p =>
    have ha' := ha a p rfl
    unfold publish at h
    by_cases hf : fits (a + sm.drift) = true
    · by_cases hf2 : fits (r - (a + sm.drift)) = true
      · cases rg with
        | none =>
          simp [hf, hf2, sampleAt, clampMax] at h
          subst h
          rw [fits_iff] at hf hf2
          constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt, elapsedAfter, satU64] <;> vc_omega
        | some b =>
          obtain ⟨mn, mx⟩ := b
          simp [hf, hf2, sampleAt, clampMax] at h
          subst h
          rw [fits_iff] at hf hf2
          constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt, elapsedAfter, satU64] <;> vc_omega
      · simp [hf, hf2, sampleAt] at h
    · simp [hf] at h
  | noSource | frozen =>
    unfold publish at h
    cases rg with
    | none =>
      simp [sampleAt, clampMax] at h
      subst h
      constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt, elapsedAfter, satU64] <;> vc_omega
    | some b =>
      obtain ⟨mn, mx⟩ := b
      simp [sampleAt, clampMax] at h
      subst h
      constructor <;> simp_all [St.following, WF, InRange, clampMax, fits_iff, sat128, sampleAt, elapsedAfter, satU64] <;> vc_omega

theorem check_none {s : St} {instant : Int} {sm : Sample} (h : check s instant sm = none) :
    s.revision ≠ u64Max ∧ InRange s.range instant ∧
      (instant > sm.instant → satU128 (s.elapsed + sm.counted) + (instant - sm.instant) ≤ u128Max) := by
  unfold check at h
  split at h
  · simp at h
  · rename_i hn
    refine ⟨fun e => hn (Or.inl e), ?_, fun hg => ?_⟩
    · intro mn mx hrg
      rw [hrg] at h
      simp only at h
      split at h
      · simp at h
      · omega
    · have := fun hh => hn (Or.inr ⟨hg, hh⟩)
      omega

/-- The outcome of a publication, seen from the state before the operation. -/
structure PubOut (s : St) (r : Int) (sm : Sample) (instant : Int) (s' : St) : Prop where
  now : s'.now = instant
  fresh : sampleAt s' r = some (⟨instant, 0, 0⟩, s')
  wall : s'.wall = s.wall
  range : s'.range = s.range
  revision : s'.revision = s.revision + 1
  elapsed : s'.elapsed = elapsedAfter s.elapsed sm instant
  wf : WF s'
  budget : instant > sm.instant → satU128 (s.elapsed + sm.counted) + (instant - sm.instant) ≤ u128Max
  not_max : s.revision ≠ u64Max

theorem pubOut_of {s s1 s2 s' : St} {r instant : Int} {sm : Sample} (hw : WF s)
    (hs : sampleAt s r = some (sm, s1)) (hc : check s1 instant sm = none)
    (hi : fits instant = true)
    (h2 : s2.elapsed = s1.elapsed ∧ s2.revision = s1.revision ∧ s2.range = s1.range ∧
      s2.wall = s1.wall ∧ s2.now = s1.now ∧ 0 ≤ s2.backwardsSets ∧ s2.backwardsSets ≤ u32Max ∧
      (∀ a p, s2.mode = .following a p → 0 ≤ p ∧ p ≤ i128Max ∧ r - a ≤ sm.drift))
    (h : publish s2 instant sm r = some s') :
    PubOut s r sm instant s' ∧ s'.backwardsSets = s2.backwardsSets ∧ s'.following = s2.following ∧
      (s2.following = false → s'.mode = s2.mode) := by
  have F := sample_facts hw hs
  obtain ⟨hrev, hrg, hbud⟩ := check_none hc
  obtain ⟨e2, r2, g2, w2, n2, b0, b1, m2⟩ := h2
  have hw2 : WF s2 := by
    obtain ⟨hn, he0, he1, hr0, hr1, _, _, _, hrg1⟩ := F.wf
    refine ⟨?_, ?_, ?_, ?_, ?_, b0, b1, fun a p hm => ?_, fun mn mx hm => ?_⟩
    · rw [n2]; exact hn
    · omega
    · omega
    · omega
    · omega
    · have := m2 a p hm; omega
    · rw [g2] at hm; rw [n2]; exact hrg1 mn mx hm
  have P := publish_facts hw2 hi (by rw [g2]; exact hrg) (by rw [r2]; exact hrev)
    (by rw [F.counted]; have := F.ge_now; omega) (fun a p hm => (m2 a p hm).2.2) h
  refine ⟨⟨P.now, P.fresh, ?_, ?_, ?_, ?_, P.wf, ?_, ?_⟩, P.back, P.following, P.mode_other⟩
  · rw [P.wall, w2, F.wall]
  · rw [P.range, g2, F.range]
  · rw [P.revision, r2, F.revision]
  · rw [P.elapsed, e2, F.elapsed]
  · rw [← F.elapsed]; exact hbud
  · rw [← F.revision]; exact hrev

theorem moveTo_cases {s s' : St} {r target : Int} {res res' : Res} {refuse count : Bool}
    (hw : WF s) (ht : fits target = true) (h : moveTo s r target res refuse count = some (res', s')) :
    (∃ sm e, sampleAt s r = some (sm, s') ∧ res' = .err e) ∨
    (∃ sm s1, sampleAt s r = some (sm, s1) ∧ check s1 target sm = none ∧ res' = res ∧
      (refuse = true → sm.instant ≤ target) ∧
      s'.backwardsSets =
        (if count = true ∧ target < sm.instant then satU32 (s.backwardsSets + 1) else s.backwardsSets) ∧
      PubOut s r sm target s') := by
  unfold moveTo at h
  cases hs : sampleAt s r with
  | none => simp [hs] at h
  | some p =>
    obtain ⟨sm, s1⟩ := p
    have F := sample_facts hw hs
    simp only [hs] at h
    split at h
    · left; simp only [Option.some.injEq, Prod.mk.injEq] at h
      exact ⟨sm, _, by rw [h.2], h.1.symm⟩
    · rename_i hnr
      cases hc : check s1 target sm with
      | some e =>
        simp only [hc, Option.some.injEq, Prod.mk.injEq] at h
        left; exact ⟨sm, e, by rw [← h.2], h.1.symm⟩
      | none =>
        simp only [hc] at h
        right
        cases hp : publish (if count = true ∧ target < sm.instant then
            { s1 with backwardsSets := satU32 (s1.backwardsSets + 1) } else s1) target sm r with
        | none => simp [hp] at h
        | some s3 =>
          simp only [hp, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          obtain ⟨_, _, _, _, _, hb0, hb1, hpk, _⟩ := F.wf
          have h2 : ∀ a p, s1.mode = .following a p → 0 ≤ p ∧ p ≤ i128Max ∧ r - a ≤ sm.drift := by
            intro a p hm
            have := hpk a p hm
            cases hm0 : s.mode with
            | following a0 p0 =>
              have := F.mode_following a0 p0 hm0
              rw [hm] at this; simp only [Mode.following.injEq] at this
              omega
            | noSource | frozen =>
              have := F.mode_other (by simp [St.following, hm0]); rw [hm, hm0] at this; cases this
          refine ⟨sm, s1, rfl, hc, rfl, fun hr => ?_, ?_, ?_⟩
          · by_cases hlt : target < sm.instant
            · exact absurd ⟨hr, hlt⟩ hnr
            · omega
          · have P := pubOut_of hw hs hc ht ?_ hp
            · rw [P.2.1, ← F.back]
              split <;> rfl
            · split <;> simp_all [satU32, u32Max] <;> omega
          · exact (pubOut_of hw hs hc ht (by split <;> simp_all [satU32, u32Max] <;> omega) hp).1

theorem resumeState_facts {s s1 s4 : St} {r instant : Int} {sm : Sample} {rd : Option Int}
    (hw : WF s) (hs : sampleAt s r = some (sm, s1)) (hrd : ∀ rr, rd = some rr → rr = r)
    (h : resumeState s1 sm instant rd r = some s4) :
    s4.elapsed = s1.elapsed ∧ s4.revision = s1.revision ∧ s4.range = s1.range ∧
      s4.wall = s1.wall ∧ s4.now = s1.now ∧
      s4.backwardsSets =
        (if instant < sm.instant then satU32 (s.backwardsSets + 1) else s.backwardsSets) ∧
      0 ≤ s4.backwardsSets ∧ s4.backwardsSets ≤ u32Max ∧
      (∀ a p, s4.mode = .following a p → 0 ≤ p ∧ p ≤ i128Max ∧ r - a ≤ sm.drift) ∧
      s4.following = true := by
  have F := sample_facts hw hs
  obtain ⟨_, _, _, _, _, hb0, hb1, hpk, _⟩ := F.wf
  have hback := F.back
  obtain ⟨now, mode, wall, back, el, rev, rg⟩ := s1
  simp only at hb0 hb1 hpk hback
  subst hback
  unfold resumeState at h
  cases mode with
  | following a p =>
    obtain ⟨a0, p0, hm0, hfm⟩ : ∃ a0 p0, s.mode = .following a0 p0 ∧ a = a0 ∧ p = sm.drift := by
      cases hm : s.mode with
      | following a0 p0 =>
        have := F.mode_following a0 p0 hm
        simp only [Mode.following.injEq] at this
        exact ⟨a0, p0, rfl, this.1.1, this.1.2⟩
      | noSource | frozen =>
        have := F.mode_other (by simp [St.following, hm]); simp [hm] at this
    have hra := (F.mode_following a0 p0 hm0).2.1
    have hpp := hpk a p rfl
    cases rd with
    | none =>
      by_cases hlt : instant < sm.instant <;> simp [hlt] at h <;> subst h <;>
        simp_all [St.following, satU32, u32Max, i128Max] <;> omega
    | some rr =>
      have := hrd rr rfl; subst rr
      by_cases hlt : instant < sm.instant <;> by_cases hf : fits (r - sm.drift) = true <;>
        simp [hlt, hf] at h <;> (try subst h) <;>
        simp_all [St.following, satU32, u32Max, fits_iff, i128Max] <;> omega
  | noSource | frozen =>
    have hfz : s.following = false := by
      cases hm : s.mode <;> simp_all [St.following] <;>
        (have := F.following; simp_all [St.following])
    have hd := (F.frozen hfz).2.2
    cases rd with
    | none =>
      by_cases hlt : instant < sm.instant <;> simp [hlt] at h <;> subst h <;>
        simp_all [St.following, satU32, u32Max, i128Max] <;> omega
    | some rr =>
      have := hrd rr rfl; subst rr
      by_cases hlt : instant < sm.instant <;> by_cases hf : fits (r - sm.drift) = true <;>
        simp [hlt, hf] at h <;> (try subst h) <;>
        simp_all [St.following, satU32, u32Max, fits_iff, i128Max] <;> omega

theorem resumeTo_cases {s s' : St} {r instant : Int} {allow : Bool} {rd : Option Int} {res : Res}
    (hw : WF s) (hi : fits instant = true) (hrd : ∀ rr, rd = some rr → rr = r)
    (h : resumeTo s instant allow rd r = some (res, s')) :
    (s' = s ∧ res = .err .noTimeSource) ∨
    (∃ sm e, sampleAt s r = some (sm, s') ∧ res = .err e) ∨
    (∃ sm s1, sampleAt s r = some (sm, s1) ∧ check s1 instant sm = none ∧ res = .unit ∧
      (allow = false → sm.instant ≤ instant) ∧
      s'.backwardsSets =
        (if instant < sm.instant then satU32 (s.backwardsSets + 1) else s.backwardsSets) ∧
      PubOut s r sm instant s' ∧ s'.following = true) := by
  unfold resumeTo at h
  split at h
  · left; simp only [Option.some.injEq, Prod.mk.injEq] at h; exact ⟨h.2.symm, h.1.symm⟩
  · cases hs : sampleAt s r with
    | none => simp [hs] at h
    | some p =>
      obtain ⟨sm, s1⟩ := p
      simp only [hs] at h
      split at h
      · right; left; simp only [Option.some.injEq, Prod.mk.injEq] at h
        exact ⟨sm, _, by rw [h.2], h.1.symm⟩
      · rename_i hnb
        cases hc : check s1 instant sm with
        | some e =>
          simp only [hc, Option.some.injEq, Prod.mk.injEq] at h
          right; left; exact ⟨sm, e, by rw [← h.2], h.1.symm⟩
        | none =>
          simp only [hc] at h
          right; right
          cases h4 : resumeState s1 sm instant rd r with
          | none => simp [h4] at h
          | some s4 =>
            simp only [h4] at h
            cases hp : publish s4 instant sm r with
            | none => simp [hp] at h
            | some s5 =>
              simp only [hp, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
              obtain ⟨rfl, rfl⟩ := h
              obtain ⟨e4, r4, g4, w4, n4, b4, b40, b41, m4, f4⟩ := resumeState_facts hw hs hrd h4
              have P := pubOut_of hw hs hc hi ⟨e4, r4, g4, w4, n4, b40, b41, m4⟩ hp
              refine ⟨sm, s1, rfl, hc, rfl, fun ha => ?_, by rw [P.2.1, b4], P.1, by rw [P.2.2.1, f4]⟩
              by_cases hlt : instant < sm.instant
              · exact absurd ⟨hlt, ha⟩ hnb
              · omega

/-- A narrower range keeps the instant a read shows, when that instant is inside it. -/
theorem restrict_live {s s1 : St} {r lo hi : Int} {sm : Sample} (hw : WF s)
    (hs : sampleAt s r = some (sm, s1)) (hlo : lo ≤ sm.instant) (hhi : sm.instant ≤ hi)
    (hnar : ∀ mn mx, s.range = some (mn, mx) → hi ≤ mx) :
    sampleAt { s1 with range := some (lo, hi) } r =
      some (⟨sm.instant, sm.drift, sm.counted⟩, { s1 with range := some (lo, hi) }) := by
  have F := sample_facts hw hs
  obtain ⟨now, mode, wall, back, el, rev, rg⟩ := s
  obtain ⟨hn, he0, he1, hr0, hr1, hb0, hb1, hp, hrg⟩ := hw
  simp only at hn hp hrg hnar
  rw [fits_iff] at hn
  cases mode with
  | following a p =>
    unfold sampleAt at hs
    by_cases hf : fits (r - a) = true
    · simp only [hf, ite_true, Option.some.injEq, Prod.mk.injEq] at hs
      obtain ⟨rfl, rfl⟩ := hs
      rw [fits_iff] at hf
      have hp' := hp a p rfl
      cases rg with
      | none => simp_all [sampleAt, clampMax, fits_iff, sat128] <;> vc_omega
      | some b =>
        obtain ⟨mn, mx⟩ := b
        have := hnar mn mx rfl
        simp_all [sampleAt, clampMax, fits_iff, sat128] <;> vc_omega
    · simp [hf] at hs
  | noSource | frozen =>
    unfold sampleAt at hs
    simp only [Option.some.injEq, Prod.mk.injEq] at hs
    obtain ⟨rfl, rfl⟩ := hs
    cases rg with
    | none => simp_all [sampleAt, clampMax, fits_iff, sat128] <;> vc_omega
    | some b =>
      obtain ⟨mn, mx⟩ := b
      have := hrg mn mx rfl
      simp_all [sampleAt, clampMax, fits_iff, sat128] <;> vc_omega

def Op.allowsBackwards : Op → Bool
  | .setAllowBackwards _ | .trySetAllowBackwards _ => true
  | .resumeAt _ allow | .resumeWall allow => allow
  | _ => false

/-- Operations that name the instant the clock moves to (or move it by a duration). -/
def Op.setsInstant : Op → Bool
  | .freeze | .resume | .restrictRange _ _ | .sync | .validateTarget _ | .read => false
  | _ => true

/-- The instant an operation names. -/
def Op.target : Op → Option Int
  | .resumeAt i _ | .advanceTo i | .set i | .setAllowBackwards i | .trySetAllowBackwards i => some i
  | _ => none

/-- A result that refuses the operation or publishes nothing. -/
def Res.refused : Res → Bool
  | .err _ | .synced false | .noWall => true
  | _ => false

/-- The operation's instants are `LogicalInstant`s and its duration a `LogicalDuration`: all
are `i128`. `w` is the wall clock's instant. -/
def Op.Fits (w : Int) : Op → Prop
  | .resumeAt i _ | .advanceTo i | .set i | .setAllowBackwards i | .trySetAllowBackwards i
  | .validateTarget i => fits i = true
  | .advance d => fits d = true
  | .resumeWall _ => fits w = true
  | .restrictRange mn mx => fits mn = true ∧ fits mx = true
  | _ => True

/-- The four shapes a step can have. -/
inductive Shape (s : St) (r : Int) (op : Op) (res : Res) (s' : St) : Prop where
  /-- Nothing was read or changed. -/
  | unchanged : s' = s → Shape s r op res s'
  /-- The source was read (the high-water mark may move) and nothing else changed. -/
  | sampled (sm : Sample) : sampleAt s r = some (sm, s') → Shape s r op res s'
  /-- `restrict_range` narrowed the range around the instant now. -/
  | ranged (sm : Sample) (s1 : St) (lo hi : Int) :
      sampleAt s r = some (sm, s1) → s' = { s1 with range := some (lo, hi) } → res = .unit →
      lo ≤ sm.instant → sm.instant ≤ hi → (∀ mn mx, s.range = some (mn, mx) → mn ≤ lo ∧ hi ≤ mx) →
      Shape s r op res s'
  /-- One publication of `instant`. -/
  | published (sm : Sample) (s1 : St) (instant : Int) :
      sampleAt s r = some (sm, s1) → check s1 instant sm = none → PubOut s r sm instant s' →
      s'.backwardsSets =
        (if instant < sm.instant then satU32 (s.backwardsSets + 1) else s.backwardsSets) →
      (instant < sm.instant → op.allowsBackwards = true) → res.refused = false →
      (op.setsInstant = false → instant = sm.instant) → (∀ i, op.target = some i → instant = i) →
      Shape s r op res s'

theorem sample_some {s : St} {r : Int} {sm sm' : Sample} {s1 s1' : St}
    (h : sampleAt s r = some (sm, s1)) (h' : sampleAt s r = some (sm', s1')) : sm' = sm ∧ s1' = s1 := by
  rw [h] at h'; simp only [Option.some.injEq, Prod.mk.injEq] at h'; exact ⟨h'.1.symm, h'.2.symm⟩

theorem shape_of_moveTo {s s' : St} {r target : Int} {res res' : Res} {refuse count : Bool} {op : Op}
    (hw : WF s) (ht : fits target = true) (h : moveTo s r target res refuse count = some (res', s'))
    (hres : res.refused = false)
    (hallow : ∀ sm s1, sampleAt s r = some (sm, s1) → target < sm.instant →
      refuse = false → count = true ∧ op.allowsBackwards = true)
    (hsets : op.setsInstant = true) (htarget : ∀ i, op.target = some i → target = i) :
    Shape s r op res' s' := by
  rcases moveTo_cases hw ht h with ⟨sm, e, hs, _⟩ | ⟨sm, s1, hs, hc, hr, href, hb, P⟩
  · exact .sampled sm hs
  · refine .published sm s1 target hs hc P ?_ ?_ (by rw [hr]; exact hres)
      (by simp [hsets]) htarget
    · rw [hb]
      by_cases hlt : target < sm.instant
      · by_cases hrf : refuse = true
        · have := href hrf; omega
        · have := (hallow sm s1 hs hlt (by simpa using hrf)).1; simp [this, hlt]
      · simp [hlt]
    · intro hlt
      by_cases hrf : refuse = true
      · have := href hrf; omega
      · exact (hallow sm s1 hs hlt (by simpa using hrf)).2

theorem shape_of_resumeTo {s s' : St} {r instant : Int} {allow : Bool} {rd : Option Int} {res : Res}
    {op : Op} (hw : WF s) (hi : fits instant = true) (hrd : ∀ rr, rd = some rr → rr = r)
    (h : resumeTo s instant allow rd r = some (res, s'))
    (hallow : allow = true → op.allowsBackwards = true)
    (hsets : op.setsInstant = false → s.following = false ∧ instant = s.now)
    (htarget : ∀ i, op.target = some i → instant = i) : Shape s r op res s' := by
  rcases resumeTo_cases hw hi hrd h with ⟨rfl, _⟩ | ⟨sm, e, hs, _⟩ |
      ⟨sm, s1, hs, hc, hr, hab, hb, P, _⟩
  · exact .unchanged rfl
  · exact .sampled sm hs
  · refine .published sm s1 instant hs hc P hb (fun hlt => ?_) (by rw [hr]; simp [Res.refused])
      (fun hn => ?_) htarget
    · cases allow
      · have := hab rfl; omega
      · exact hallow rfl
    · obtain ⟨hf, rfl⟩ := hsets hn
      exact ((sample_facts hw hs).frozen hf).2.1.symm

theorem shape_of_advance {s s' : St} {r d : Int} {res : Res} {op : Op} (hw : WF s)
    (h : advance s r d = some (res, s')) (hsets : op.setsInstant = true) (ht : op.target = none) :
    Shape s r op res s' := by
  unfold advance at h
  split at h
  · simp only [Option.some.injEq, Prod.mk.injEq] at h
    exact .unchanged h.2.symm
  · rename_i hd
    cases hs : sampleAt s r with
    | none => simp [hs] at h
    | some p =>
      obtain ⟨sm, s1⟩ := p
      simp only [hs] at h
      split at h
      · rename_i hf
        exact shape_of_moveTo hw hf h (by simp [Res.refused]) (fun sm1 s11 hs1 hlt _ => by
          obtain ⟨rfl, rfl⟩ := sample_some hs hs1; omega) hsets (by simp [ht])
      · simp only [Option.some.injEq, Prod.mk.injEq] at h
        exact .sampled sm (by rw [hs, h.2])

/-- A read on its own changes nothing but the high-water mark. -/
theorem shape_of_sample {s s' : St} {r : Int} {res : Res} {op : Op} {sm : Sample}
    (h : sampleAt s r = some (sm, s')) : Shape s r op res s' := .sampled sm h

theorem step_shape {s s' : St} {r w : Int} {op : Op} {res : Res} (hw : WF s) (hop : op.Fits w)
    (h : step s r w op = some (res, s')) : Shape s r op res s' := by
  cases op with
  | freeze =>
    simp only [step] at h
    cases hm : s.mode with
    | noSource | frozen =>
      simp only [hm, Option.some.injEq, Prod.mk.injEq] at h
      exact .unchanged h.2.symm
    | following a p =>
      simp only [hm] at h
      cases hs : sampleAt s r with
      | none => simp [hs] at h
      | some p =>
        obtain ⟨sm, s1⟩ := p
        simp only [hs] at h
        cases hc : check s1 sm.instant sm with
        | some e =>
          simp only [hc, Option.some.injEq, Prod.mk.injEq] at h
          exact .sampled sm (by rw [hs, h.2])
        | none =>
          simp only [hc] at h
          cases hp : publish { s1 with mode := .frozen } sm.instant sm r with
          | none => simp [hp] at h
          | some s2 =>
            simp only [hp, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
            obtain ⟨rfl, rfl⟩ := h
            have F := sample_facts hw hs
            obtain ⟨_, _, _, _, _, hb0, hb1, _, _⟩ := F.wf
            have P := pubOut_of (s2 := { s1 with mode := .frozen }) hw hs hc F.fits_instant
              ⟨rfl, rfl, rfl, rfl, rfl, hb0, hb1, fun a p hm => by cases hm⟩ hp
            refine .published sm s1 sm.instant hs hc P.1 ?_ (fun hlt => by omega) (by simp [Res.refused])
              (fun _ => rfl) (by simp [Op.target])
            rw [P.2.1, F.back]; simp
  | resume =>
    simp only [step] at h
    cases hm : s.mode with
    | following a p =>
      simp only [hm, Option.some.injEq, Prod.mk.injEq] at h
      exact .unchanged h.2.symm
    | noSource | frozen =>
      simp only [hm] at h
      exact shape_of_resumeTo hw hw.1 (by simp) h (by simp)
        (fun _ => ⟨by simp [St.following, hm], rfl⟩) (by simp [Op.target])
  | resumeAt i allow =>
    simp only [step] at h
    exact shape_of_resumeTo hw hop (by simp) h (by simp [Op.allowsBackwards])
      (by simp [Op.setsInstant]) (by simp [Op.target])
  | resumeWall allow =>
    simp only [step] at h
    split at h
    · simp only [Option.some.injEq, Prod.mk.injEq] at h
      exact .unchanged h.2.symm
    · exact shape_of_resumeTo hw hop (by simp) h (by simp [Op.allowsBackwards])
        (by simp [Op.setsInstant]) (by simp [Op.target])
  | advance d => exact shape_of_advance hw h rfl rfl
  | tick => exact shape_of_advance hw h rfl rfl
  | advanceTo i =>
    exact shape_of_moveTo hw hop h (by simp [Res.refused]) (by simp) rfl (by simp [Op.target])
  | set i =>
    exact shape_of_moveTo hw hop h (by simp [Res.refused]) (by simp) rfl (by simp [Op.target])
  | trySetAllowBackwards i =>
    exact shape_of_moveTo hw hop h (by simp [Res.refused]) (by simp [Op.allowsBackwards]) rfl
      (by simp [Op.target])
  | setAllowBackwards i =>
    simp only [step] at h
    cases hm : moveTo s r i .unit false true with
    | none => simp [hm] at h
    | some p =>
      obtain ⟨res0, s0⟩ := p
      simp only [hm, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
      obtain ⟨rfl, rfl⟩ := h
      rcases shape_of_moveTo (op := .setAllowBackwards i) hw hop hm (by simp [Res.refused])
          (by simp [Op.allowsBackwards]) rfl (by simp [Op.target]) with
          h0 | ⟨sm, h0⟩ | ⟨sm, s1, lo, hi, h1, h2, _, h3, h4, h5⟩ |
          ⟨sm, s1, inst, hs, hc, P, hb, ha, _, hst, htg⟩
      · exact .unchanged h0
      · exact .sampled sm h0
      · exact .ranged sm s1 lo hi h1 h2 rfl h3 h4 h5
      · exact .published sm s1 inst hs hc P hb ha (by simp [Res.refused]) hst htg
  | restrictRange mn mx =>
    simp only [step] at h
    cases hs : sampleAt s r with
    | none => cases hrg : s.range <;> simp [hs] at h
    | some p =>
      obtain ⟨sm, s1⟩ := p
      cases hrg : s.range with
      | none =>
        simp only [hrg, hs] at h
        split at h
        · simp only [Option.some.injEq, Prod.mk.injEq] at h
          exact .sampled sm (by rw [hs, h.2])
        · simp only [Option.some.injEq, Prod.mk.injEq] at h
          exact .ranged sm s1 mn mx hs h.2.symm h.1.symm (by omega) (by omega)
            (by intro a b hab; rw [hrg] at hab; cases hab)
      | some b =>
        obtain ⟨l, hh⟩ := b
        simp only [hrg, hs] at h
        split at h
        · simp only [Option.some.injEq, Prod.mk.injEq] at h
          exact .sampled sm (by rw [hs, h.2])
        · simp only [Option.some.injEq, Prod.mk.injEq] at h
          exact .ranged sm s1 _ _ hs h.2.symm h.1.symm (by omega) (by omega)
            (by intro a b hab; rw [hrg] at hab; simp only [Option.some.injEq, Prod.mk.injEq] at hab; omega)
  | sync =>
    simp only [step] at h
    cases hm : s.mode with
    | noSource | frozen =>
      simp only [hm, Option.some.injEq, Prod.mk.injEq] at h
      exact .unchanged h.2.symm
    | following a p =>
      simp only [hm] at h
      cases hs : sampleAt s r with
      | none => simp [hs] at h
      | some q =>
        obtain ⟨sm, s1⟩ := q
        simp only [hs] at h
        split at h
        · simp only [Option.some.injEq, Prod.mk.injEq] at h
          exact .sampled sm (by rw [hs, h.2])
        · rename_i hns
          cases hc : check s1 sm.instant sm with
          | some e => simp [hc] at hns
          | none =>
            cases hp : publish s1 sm.instant sm r with
            | none => simp [hp] at h
            | some s2 =>
              simp only [hp, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
              obtain ⟨rfl, rfl⟩ := h
              have F := sample_facts hw hs
              obtain ⟨_, _, _, _, _, hb0, hb1, hpk, _⟩ := F.wf
              have hmf := F.mode_following a p hm
              have P := pubOut_of (s2 := s1) hw hs hc F.fits_instant
                ⟨rfl, rfl, rfl, rfl, rfl, hb0, hb1, fun a' p' hm' => by
                  rw [hmf.1] at hm'; simp only [Mode.following.injEq] at hm'
                  obtain ⟨rfl, rfl⟩ := hm'
                  have := hpk a sm.drift hmf.1
                  omega⟩ hp
              refine .published sm s1 sm.instant hs hc P.1 ?_ (fun hlt => by omega) (by simp [Res.refused])
                (fun _ => rfl) (by simp [Op.target])
              rw [P.2.1, F.back]; simp
  | validateTarget i =>
    simp only [step] at h
    cases hs : sampleAt s r with
    | none => simp [hs] at h
    | some q =>
      obtain ⟨sm, s1⟩ := q
      simp only [hs] at h
      split at h <;> simp only [Option.some.injEq, Prod.mk.injEq] at h <;>
        exact .sampled sm (by rw [hs, h.2])
  | read =>
    simp only [step] at h
    cases hs : sampleAt s r with
    | none => simp [hs] at h
    | some q =>
      obtain ⟨sm, s1⟩ := q
      simp only [hs, Option.map_some, Option.some.injEq, Prod.mk.injEq] at h
      exact .sampled sm (by rw [hs, h.2])

end VC
