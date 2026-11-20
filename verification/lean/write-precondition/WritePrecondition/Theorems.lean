import WritePrecondition.Model

namespace WP

theorem check_passes (s : State) (p : Condition) :
    checkPrecondition p s = none ↔ Satisfied s p := by
  cases p with
  | none => cases s <;> simp [checkPrecondition, Satisfied]
  | «exists» b => cases b <;> cases s <;> simp [checkPrecondition, Satisfied]
  | updateTime t =>
    cases s with
    | none => simp [checkPrecondition, Satisfied]
    | some saved => by_cases h : saved = t <;> simp [checkPrecondition, Satisfied, h]

theorem check_refuses (s : State) (p : Condition) (e : Error) :
    checkPrecondition p s = some e ↔ ¬ Satisfied s p ∧ PreconditionRefusal p e := by
  constructor
  · intro h
    refine ⟨fun yes => by rw [(check_passes s p).mpr yes] at h; contradiction, ?_⟩
    cases p with
    | none => cases s <;> simp [checkPrecondition] at h
    | «exists» b =>
      cases b <;> cases s <;> simp [checkPrecondition] at h
      · subst e; exact .existing
      · subst e; exact .missing
    | updateTime t =>
      cases s with
      | none => simp [checkPrecondition] at h; subst e; exact .stale t
      | some saved =>
        by_cases eq : saved = t <;> simp [checkPrecondition, eq] at h
        subst e
        exact .stale t
  · rintro ⟨hn, h⟩
    cases h with
    | missing => cases s <;> simp_all [Satisfied, checkPrecondition]
    | existing => cases s <;> simp_all [Satisfied, checkPrecondition]
    | stale t => cases s <;> simp_all [Satisfied, checkPrecondition]

theorem step_spec (now : Int) (s : State) (p : Condition) (effect : Effect) (out : Outcome) :
    Rule now s p effect out ↔ step now s p effect = out := by
  constructor
  · intro rule
    cases rule with
    | precondition hn h => simp [step, (check_refuses _ _ _).mpr ⟨hn, h⟩]
    | invalid h => simp [step, (check_passes _ _).mpr h]
    | delete h => simp [step, (check_passes _ _).mpr h]
    | preserve h ht => rw [step, (check_passes s p).mpr h]; simp [ht]
    | stamp h hs =>
      rw [step, (check_passes s p).mpr h]
      rcases hs with same | missing
      · simp [same]
      · simp [missing]
  · rintro rfl
    cases h : checkPrecondition p s with
    | some e =>
      obtain ⟨hn, code⟩ := (check_refuses s p e).mp h
      simpa [step, h] using (Rule.precondition (now := now) (effect := effect) hn code)
    | none =>
      have yes := (check_passes s p).mp h
      simp only [step.eq_def, h]
      cases effect with
      | invalid => exact (Rule.invalid (now := now) yes)
      | delete => exact (Rule.delete (now := now) yes)
      | store same =>
        cases same with
        | false => exact (Rule.stamp (now := now) yes (Or.inl rfl))
        | true =>
          cases hs : s with
          | none => simpa [hs] using
              (Rule.stamp (now := now) (same := true) yes (Or.inr hs))
          | some t => simpa [hs] using (Rule.preserve (now := now) yes hs)

theorem exactly_one_outcome (now : Int) (s : State) (p : Condition) (effect : Effect) :
    ∃ out, Rule now s p effect out ∧ ∀ other, Rule now s p effect other → other = out :=
  ⟨step now s p effect, (step_spec ..).mpr rfl, fun _ h => ((step_spec ..).mp h).symm⟩

theorem create_agrees_with_set_exists_false (now : Int) (doc : Option Document) (value : Option Int) :
    stage now doc (create value) = stage now doc ⟨.replace value, .exists false⟩ := rfl

/-- Both an unmasked update and a masked update use this same precondition check. -/
theorem update_without_precondition_iff_present (now : Int) (s : State) (effect : Effect) :
    step now s .none effect = step now s (.exists true) effect ↔ s.isSome = true := by
  cases s with
  | none => cases effect <;> simp [step, checkPrecondition]
  | some t => simp [step, checkPrecondition]

theorem update_stage_without_precondition_iff_present (now : Int) (doc : Option Document)
    (op : Operation) :
    stage now doc ⟨op, .none⟩ = stage now doc ⟨op, .exists true⟩ ↔ doc.isSome = true := by
  cases doc with
  | none =>
    rcases h : body op none with ⟨effect, value⟩
    cases effect <;> simp [stage, documentTime, h, step, checkPrecondition, Except.map]
  | some doc =>
    rcases h : body op doc.value with ⟨effect, value⟩
    simp [stage, documentTime, h, step, checkPrecondition]

theorem absent_delete_without_precondition (now : Int) :
    step now none .none .delete = .ok none := rfl

theorem absent_delete_with_exists_true (now : Int) :
    step now none (.exists true) .delete = .error .notFound := rfl

theorem update_time_exact (s : State) (t : Int) :
    checkPrecondition (.updateTime t) s = none ↔ s = some t :=
  check_passes s (.updateTime t)

theorem commit_time_aligned (last : State) (now : Int)
    (aligned : ∀ t, last = some t → t % 1000 = 0) :
    nextCommitTime last now % 1000 = 0 ∧
      ∀ doc next,
        nextCommitTime (some (importClock (nextCommitTime last now) doc)) next % 1000 = 0 := by
  have stamp_aligned (prior : State) (clock : Int)
      (h : ∀ t, prior = some t → t % 1000 = 0) : nextCommitTime prior clock % 1000 = 0 := by
    cases prior with
    | none => simp [nextCommitTime]
    | some t =>
      have ht := h t rfl
      simp only [nextCommitTime]
      split <;> omega
  have import_stamp := stamp_aligned last now aligned
  refine ⟨import_stamp, ?_⟩
  intro doc next
  apply stamp_aligned
  rintro _ ⟨rfl⟩
  cases doc with
  | none => exact import_stamp
  | some doc =>
    simp only [importClock, Int.max_def]
    split <;> omega

theorem refused_write_changes_nothing (now : Int) (s : State) (p : Condition)
    (effect : Effect) (e : Error) (refusal : step now s p effect = .error e) :
    publishedState s (step now s p effect) = s := by rw [refusal]; rfl

theorem refused_batch_changes_nothing (now : Int) (doc : Option Document) (writes : List Write)
    (e : Error) (refusal : batch now doc writes = .error e) :
    publishedDocument doc (batch now doc writes) = doc := by rw [refusal]; rfl

/-- A successful storing write can be repeated with its reported time, whether or not the first write changed that time. The second evaluation of the write body must also be valid. -/
theorem retry_with_reported_update_time (now next : Int) (s : State) (p : Condition)
    (first : Effect) (same : Bool) (t : Int) (applied : step now s p first = .ok (some t)) :
    ∃ t', step next (publishedState s (step now s p first)) (.updateTime t) (.store same) =
      .ok (some t') := by
  rw [applied]
  cases same
  · exact ⟨next, by simp [publishedState, step, checkPrecondition]⟩
  · exact ⟨t, by simp [publishedState, step, checkPrecondition]⟩

theorem retry_iff_changed_for_fresh_stamp (now next : Int) (s : State) (p : Condition)
    (sameFirst sameNext : Bool) (t : Int)
    (applied : step now s p (.store sameFirst) = .ok (some t))
    (stamped : sameFirst = false ∨ s = none) (fresh : s ≠ some now) :
    (∃ t', step next (publishedState s (step now s p (.store sameFirst)))
        (.updateTime t) (.store sameNext) = .ok (some t')) ↔ s ≠ some t := by
  have ht : now = t := by
    rcases stamped with same | absent
    · cases h : checkPrecondition p s <;> simp [step, h, same] at applied
      exact applied
    · subst s
      cases h : checkPrecondition p none <;> simp [step, h] at applied
      exact applied
  constructor
  · intro _; simpa [← ht] using fresh
  · intro _; exact retry_with_reported_update_time now next s p _ sameNext t applied

end WP
