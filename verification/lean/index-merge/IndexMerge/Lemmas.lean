import IndexMerge.Spec

/-!
# Lemmas about the model: sorting, the greedy cover, candidates
-/

namespace IM

/-! ## Sorting keeps the elements -/

theorem mem_insertDesc {x y : List Cov × Index} {l : List (List Cov × Index)} :
    y ∈ insertDesc x l ↔ y = x ∨ y ∈ l := by
  induction l with
  | nil => simp [insertDesc]
  | cons z zs ih =>
    unfold insertDesc
    split <;> simp_all [or_left_comm]

theorem mem_sortDesc {y : List Cov × Index} {l : List (List Cov × Index)} :
    y ∈ sortDesc l ↔ y ∈ l := by
  induction l with
  | nil => simp [sortDesc]
  | cons z zs ih => simp [sortDesc, mem_insertDesc, ih]

theorem mem_insertField {x y : Field} {l : List Field} : y ∈ insertField x l ↔ y = x ∨ y ∈ l := by
  induction l with
  | nil => simp [insertField]
  | cons z zs ih =>
    unfold insertField
    split <;> simp_all [or_left_comm]

theorem mem_sortFields {y : Field} {l : List Field} : y ∈ sortFields l ↔ y ∈ l := by
  induction l with
  | nil => simp [sortFields]
  | cons z zs ih => simp [sortFields, mem_insertField, ih]

/-! ## The greedy cover -/

/-- What the greedy loop covers is what it started with plus the fields of the candidates it
took, and every member it returns is a candidate it took. -/
theorem greedy_spec (cov : List Cov) (cs : List (List Cov × Index)) :
    ∃ chosen : List (List Cov × Index), (∀ p ∈ chosen, p ∈ cs) ∧
      (greedy cov cs).2 = chosen.map (·.2) ∧
      ∀ x, x ∈ (greedy cov cs).1 ↔ (x ∈ cov ∨ ∃ p ∈ chosen, x ∈ p.1) := by
  induction cs generalizing cov with
  | nil => exact ⟨[], by simp, by simp [greedy], by simp [greedy]⟩
  | cons p rest ih =>
    unfold greedy
    split
    · obtain ⟨ch, hsub, hms, hcov⟩ := ih cov
      exact ⟨ch, fun q hq => List.mem_cons_of_mem _ (hsub q hq), hms, hcov⟩
    · obtain ⟨ch, hsub, hms, hcov⟩ := ih (cov ++ p.1)
      refine ⟨p :: ch, ?_, by simp [hms], ?_⟩
      · intro q hq
        rcases List.mem_cons.mp hq with h | h
        · exact h ▸ List.mem_cons_self
        · exact List.mem_cons_of_mem _ (hsub q h)
      · intro x
        rw [hcov x]
        simp only [List.mem_append, List.mem_cons, exists_eq_or_imp]
        exact or_assoc

/-- Everything the greedy loop started with stays covered. -/
theorem greedy_keeps (cov : List Cov) (cs : List (List Cov × Index)) {x : Cov}
    (h : x ∈ cov) : x ∈ (greedy cov cs).1 := by
  obtain ⟨_, _, _, hcov⟩ := greedy_spec cov cs
  exact (hcov x).2 (Or.inl h)

/-- The greedy loop covers the fields of every candidate: a skipped one was already covered. -/
theorem greedy_covers (cov : List Cov) (cs : List (List Cov × Index)) :
    ∀ p ∈ cs, ∀ x ∈ p.1, x ∈ (greedy cov cs).1 := by
  induction cs generalizing cov with
  | nil => simp
  | cons q rest ih =>
    intro p hp x hx
    unfold greedy
    split
    · rename_i hall
      rcases List.mem_cons.mp hp with h | h
      · subst h
        exact greedy_keeps cov rest (by simpa using (List.all_eq_true.mp hall) x hx)
      · exact ih cov p h x hx
    · rcases List.mem_cons.mp hp with h | h
      · subst h
        exact greedy_keeps _ rest (List.mem_append_right _ hx)
      · exact ih _ p h x hx

/-! ## Modes -/

/-- An enabled mode means the field is not exempt: the exemption check in `merged_indexes_for`
never decides anything once the mode is enabled. -/
theorem not_exempt_of_hasMode {s : ISet} {coll : Nat} {f : Field} {group : Bool} {m : Mode}
    (h : hasMode s coll f group m = true) : isExempt s coll f group = false := by
  unfold hasMode at h
  unfold isExempt
  obtain ⟨p, hp, hpm⟩ := List.any_eq_true.mp h
  simp only [Bool.and_eq_true, beq_iff_eq] at hpm
  simp only [Bool.not_eq_false', List.any_eq_true]
  refine ⟨p, hp, ?_⟩
  cases group <;> simp [scopeFor] at hpm <;> simp [hpm.1]

theorem hasMode_mono {s s' : ISet} (hle : s.le s') {coll : Nat} {f : Field} {group : Bool}
    {m : Mode} (h : hasMode s coll f group m = true) : hasMode s' coll f group m = true := by
  unfold hasMode at *
  obtain ⟨p, hp, hpm⟩ := List.any_eq_true.mp h
  exact List.any_eq_true.mpr ⟨p, hle.2 _ _ _ hp, hpm⟩

theorem isExempt_mono {s s' : ISet} (hle : s.le s') {coll : Nat} {f : Field} {group : Bool}
    (h : isExempt s' coll f group = true) : isExempt s coll f group = true := by
  unfold isExempt at *
  simp only [Bool.not_eq_true', List.any_eq_false] at *
  exact fun p hp => h p (hle.2 _ _ _ hp)

/-! ## `compositeServes` reads the equality fields only through their count and membership -/

theorem compositeServes_congr (idx : Index) (r₁ r₂ : Req) (coll : Nat) (group : Bool)
    (hlen : r₁.eq.length = r₂.eq.length) (hmem : ∀ x, x ∈ r₁.eq ↔ x ∈ r₂.eq)
    (hc : r₁.contains = r₂.contains) (ho : r₁.order = r₂.order) :
    compositeServes idx r₁ coll group = compositeServes idx r₂ coll group := by
  unfold compositeServes
  rw [hlen, hc, ho]
  have hcontains : ∀ y, r₁.eq.contains y = r₂.eq.contains y := fun y => by
    apply Bool.eq_iff_iff.mpr
    simp [hmem]
  have hany : ∀ pre : List IField,
      (r₁.eq.any fun p => !(pre.any (·.path == p))) = (r₂.eq.any fun p => !(pre.any (·.path == p))) :=
    fun pre => by
      apply Bool.eq_iff_iff.mpr
      simp only [List.any_eq_true]
      exact ⟨fun ⟨x, hx, h⟩ => ⟨x, (hmem x).1 hx, h⟩, fun ⟨x, hx, h⟩ => ⟨x, (hmem x).2 hx, h⟩⟩
  simp only [hcontains, hany]

end IM
