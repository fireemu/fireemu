import StoragePrecondition.Model

namespace SP

private theorem absent412 (guards : List Guard) :
    (guards.any (fun | .generationMatch n => n != 0 | _ => true) = true) ↔
      Has412 none guards := by
  simp only [List.any_eq_true, Has412]
  exact exists_congr (fun guard => by cases guard <;> simp [Fails412])

private theorem present412 (o : ObjectId) (guards : List Guard) :
    (guards.any (fun
        | .generationMatch n => o.generation != n
        | .metagenerationMatch n => o.metageneration != n
        | _ => false) = true) ↔ Has412 (some o) guards := by
  simp only [List.any_eq_true, Has412]
  exact exists_congr (fun guard => by cases guard <;> simp [Fails412])

private theorem present304 (o : ObjectId) (guards : List Guard) :
    (guards.any (fun
        | .generationNotMatch n => o.generation == n
        | .metagenerationNotMatch n => o.metageneration == n
        | _ => false) = true) ↔ Has304 (some o) guards := by
  simp only [List.any_eq_true, Has304]
  exact exists_congr (fun guard => by cases guard <;> simp [Fails304])

private theorem check_priority (current : Current) (guards : List Guard)
    [Decidable (Has412 current guards)] [Decidable (Has304 current guards)] :
    check current guards =
      if Has412 current guards then .failed
      else if Has304 current guards then .notModified else .proceed := by
  cases current with
  | none =>
    have h : ¬ Has304 none guards := by
      rintro ⟨guard, _, h⟩
      cases guard <;> exact h
    simp only [check, ite_eq_right h]
    exact ite_congr (propext (absent412 guards)) (fun _ => rfl) (fun _ => rfl)
  | some o =>
    simp only [check]
    exact ite_congr (propext (present412 o guards)) (fun _ => rfl)
      (fun _ => ite_congr (propext (present304 o guards)) (fun _ => rfl) (fun _ => rfl))

theorem check_iff_all_pass (current : Current) (guards : List Guard) :
    check current guards = .proceed ↔ ∀ guard ∈ guards, Passes current guard := by
  classical
  have priority : check current guards = .proceed ↔
      ¬ Has412 current guards ∧ ¬ Has304 current guards := by
    by_cases h412 : Has412 current guards <;> by_cases h304 : Has304 current guards <;>
      simp [check_priority, h412, h304]
  rw [priority]
  constructor
  · rintro ⟨no412, no304⟩ guard member
    exact ⟨fun h => no412 ⟨guard, member, h⟩, fun h => no304 ⟨guard, member, h⟩⟩
  · intro passes
    constructor
    · rintro ⟨guard, member, h⟩
      exact (passes guard member).1 h
    · rintro ⟨guard, member, h⟩
      exact (passes guard member).2 h

/-- Every verdict is exclusive and the model computes the unique one. -/
theorem decide_iff_spec (op : Op) (current : Current) (guards : List Guard) (d : Decision) :
    decideOp op current guards = d ↔ Verdict op current guards d := by
  classical
  by_cases fail : Has412 current guards <;> by_cases unchanged : Has304 current guards <;>
    cases op <;> cases current <;> cases d <;>
    simp [decideOp, check_priority, Verdict, MissingBefore, MissingAfter, fail, unchanged]

theorem verdict_exists_unique (op : Op) (current : Current) (guards : List Guard) :
    ∃ d, Verdict op current guards d ∧ ∀ other, Verdict op current guards other → other = d := by
  refine ⟨decideOp op current guards, (decide_iff_spec ..).mp rfl, ?_⟩
  intro other h
  exact ((decide_iff_spec ..).mpr h).symm

theorem decision_depends_only_on_object (op : Op) (a b : State) (guards : List Guard)
    (h : a.current = b.current) :
    decideOp op a.current guards = decideOp op b.current guards := by rw [h]

theorem order_independent (op : Op) (current : Current) {a b : List Guard}
    (h : a.Perm b) : decideOp op current a = decideOp op current b := by
  have spec := (decide_iff_spec op current a _).mp rfl
  apply ((decide_iff_spec op current b _).mpr _).symm
  generalize decideOp op current a = d at spec ⊢
  cases d <;>
    simpa only [Verdict, Has412, Has304, ← h.mem_iff] using spec

theorem generation_match_not_match_exclusive (current : Current) (n : Nat) :
    ¬ (Passes current (.generationMatch n) ∧ Passes current (.generationNotMatch n)) := by
  cases current <;> simp [Passes, Fails412, Fails304]

theorem metageneration_match_not_match_exclusive (current : Current) (n : Nat) :
    ¬ (Passes current (.metagenerationMatch n) ∧ Passes current (.metagenerationNotMatch n)) := by
  cases current <;> simp [Passes, Fails412, Fails304]

theorem zero_match_iff_absent (current : Current)
    (positive : ∀ o, current = some o → 0 < o.generation) :
    check current [.generationMatch 0] = .proceed ↔ current = none := by
  cases current with
  | none => decide
  | some o => simp [check, Nat.ne_of_gt (positive o rfl)]

theorem raw_zero_generation_passes_zero_match :
    check (some ⟨0, 1⟩) [.generationMatch 0] = .proceed := by decide

theorem absent_guard (guard : Guard) :
    Passes none guard ↔ guard = .generationMatch 0 := by
  cases guard <;> simp [Passes, Fails412, Fails304]

theorem absent_read (guards : List Guard) : decideOp .read none guards = .notFound := rfl

theorem absent_write_rules (op : Op) (guards : List Guard) (notRead : op ≠ .read) :
    decideOp op none guards =
      if guards.all (· == .generationMatch 0) then
        if op = .upload ∨ op = .finalize then .proceed else .notFound
      else .failed := by
  have h : (guards.all (· == .generationMatch 0) = true) ↔ ¬ Has412 none guards := by
    simp only [List.all_eq_true, Has412, not_exists, not_and]
    exact forall_congr' (fun guard => by cases guard <;> simp [Fails412])
  classical
  have absent304 : ¬ Has304 none guards := by
    rintro ⟨guard, _, hg⟩
    cases guard <;> exact hg
  by_cases failed : Has412 none guards <;> cases op <;>
    simp [decideOp, check_priority, absent304, h, failed] at *

theorem absent_read_differs_from_live_mutations :
    decideOp .read none [.generationMatch 7] = .notFound ∧
      decideOp .metadata none [.generationMatch 7] = .failed ∧
      decideOp .delete none [.generationMatch 7] = .failed := by decide

theorem failed_match_takes_priority :
    decideOp .read (some ⟨7, 3⟩) [.generationNotMatch 7, .metagenerationMatch 4] = .failed := by
  decide

theorem refused_preserves_object_state (s : State) (op : Op) (guards : List Guard)
    (production : Bool) (now : Int) (h : ∀ o, (step s op guards production now).1 ≠ .applied o) :
    (step s op guards production now).2 = s := by
  cases hd : decideOp op s.current guards <;> simp [step, hd]
  cases op <;> simp at h ⊢
  all_goals
    simp only [step, hd] at h
  case proceed.read =>
    cases s.current <;> rfl
  case proceed.metadata =>
    cases hc : s.current with
    | none => simp
    | some o =>
      by_cases bound : o.metageneration + 1 ≤ maxIdentity
      · simp [hc, bound] at h
      · simp [bound]
  case proceed.delete =>
    cases hc : s.current with
    | none => simp
    | some o => simp [hc] at h
  all_goals
    cases hn : nextGeneration s.lastGeneration production now with
    | none => simp
    | some g => simp [hn] at h

theorem finalize_refusal_aborts (s : State) (guards : List Guard) (production : Bool) (now : Int)
    (h : ∀ o, (step s .finalize guards production now).1 ≠ .applied o) :
    finalizePhase (step s .finalize guards production now).1 = .aborted ∧
      (step s .finalize guards production now).2 = s := by
  refine ⟨?_, refused_preserves_object_state _ _ _ _ _ h⟩
  cases hr : (step s .finalize guards production now).1 with
  | applied o => exact (h o hr).elim
  | refused _ | identityExhausted => rfl

theorem refused_finalize_changes_session :
    (step ⟨none, 0⟩ .finalize [.generationMatch 7] false 0).1 = .refused .failed ∧
      finalizePhase (step ⟨none, 0⟩ .finalize [.generationMatch 7] false 0).1 ≠ .receiving := by
  decide

theorem exhausted_identity_can_refuse_after_guards_pass :
    decideOp .upload (some ⟨maxIdentity, 1⟩) [] = .proceed ∧
      (step ⟨some ⟨maxIdentity, 1⟩, maxIdentity⟩ .upload [] false 0).1 = .identityExhausted ∧
      (step ⟨some ⟨7, maxIdentity⟩, 7⟩ .metadata [] false 0).1 = .identityExhausted := by
  decide

private theorem next_generation_increases (last g : Nat) (production : Bool) (now : Int)
    (h : nextGeneration last production now = some g) : last < g := by
  let micros := now / 1000
  let floor := if 0 ≤ micros ∧ micros ≤ Int.ofNat maxU64 then micros.toNat else 0
  let drawn := if production then max (last + 1) floor else last + 1
  change (if last + 1 > maxU64 then none
    else if drawn ≤ maxIdentity then some drawn else none) = some g at h
  by_cases overflow : last + 1 > maxU64
  · simp [overflow] at h
  by_cases bound : drawn ≤ maxIdentity
  · simp [overflow, bound] at h
    rw [← h]
    cases production <;> simp [drawn] <;> omega
  · simp [overflow, bound] at h

theorem successful_upload_generation (s : State) (guards : List Guard) (production : Bool)
    (now : Int) (op : Op) (isUpload : op = .upload ∨ op = .finalize) (returned : ObjectId)
    (success : (step s op guards production now).1 = .applied returned)
    (counterCoversCurrent : ∀ old, s.current = some old → old.generation ≤ s.lastGeneration) :
    let current := (step s op guards production now).2.current
    check current [.generationMatch returned.generation] = .proceed ∧
      ∀ old, s.current = some old → check current [.generationMatch old.generation] = .failed := by
  have allowed : decideOp op s.current guards = .proceed := by
    cases hd : decideOp op s.current guards <;> simp [step, hd] at success ⊢
  rcases isUpload with rfl | rfl <;>
    cases hn : nextGeneration s.lastGeneration production now <;>
    simp [step, allowed, hn] at success ⊢
  all_goals
    subst returned
    refine ⟨by simp [check], ?_⟩
    intro old hold
    have newer := next_generation_increases _ _ _ _ hn
    have different := Nat.ne_of_gt (Nat.lt_of_le_of_lt (counterCoversCurrent old hold) newer)
    simp [check, different]

theorem execution_can_depend_on_counter :
    (step ⟨none, 0⟩ .upload [.generationMatch 0] false 0).1 = .applied ⟨1, 1⟩ ∧
      (step ⟨none, maxIdentity⟩ .upload [.generationMatch 0] false 0).1 = .identityExhausted := by
  decide

theorem stale_counter_can_repeat_generation :
    (step ⟨some ⟨1, 3⟩, 0⟩ .upload [.generationMatch 1] false 0).1 = .applied ⟨1, 1⟩ := by
  decide

theorem successful_metadata_preserves_generation (s : State) (old new : ObjectId)
    (guards : List Guard) (production : Bool) (now : Int)
    (current : s.current = some old) (success : (step s .metadata guards production now).1 = .applied new) :
    new.generation = old.generation ∧ new.metageneration = old.metageneration + 1 ∧
      (step s .metadata guards production now).2.current = some new := by
  cases hd : decideOp .metadata (some old) guards <;> simp [step, current, hd] at success ⊢
  by_cases bound : old.metageneration + 1 ≤ maxIdentity
  · simp [bound] at success ⊢
    subst new
    simp
  · simp [bound] at success

theorem metadata_write_keeps_generation :
    (step ⟨some ⟨7, 3⟩, 7⟩ .metadata [] false 0).1 = .applied ⟨7, 4⟩ ∧
      check (step ⟨some ⟨7, 3⟩, 7⟩ .metadata [] false 0).2.current
        [.generationMatch 7] = .proceed := by decide

end SP
