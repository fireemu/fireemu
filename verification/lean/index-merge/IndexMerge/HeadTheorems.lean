import IndexMerge.Head
import IndexMerge.Theorems

/-!
# Properties of the head decision

- `head_eq_base_outside_guards`: when no override fires (`guardOf` is none), the head answer is
  the base answer, verdict, members and their order, for the whole query;
  `head_eq_base_off_gate`, `head_eq_base_emulator`, `head_eq_base_enterprise`,
  `head_eq_base_group`: in particular for the emulator policy, on Enterprise and at
  collection-group scope.
- `head_override`: what each override answers.
- `first_attempt_kept`: whenever the base merge serves, the head answer is the base answer.
- `recorded_kinds`, `head_merge_kinds`: a merge the recorded rules add covers every equality by
  a member with that field in an ordered mode and the array filter by a member with that field
  in contains mode.
-/

namespace IM

/-! ## Head and base agree outside the guards -/

/-- When none of the overrides (c), (a), (b) fires, the head answer is the base answer. -/
theorem head_eq_base_outside_guards (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (ha : guardOf q s p e ≠ .a) (hb : guardOf q s p e ≠ .b) (hc : guardOf q s p e ≠ .c) :
    decideHead q s p e = decideBase q s p e := by
  unfold decideHead
  unfold guardOf at ha hb hc
  cases hg : gate q p e
  · simp
  · simp only [hg, Bool.not_true, Bool.false_eq_true, ite_false] at ha hb hc ⊢
    cases hd : decideBase q s p e with
    | use i =>
      simp only [hd] at hc ⊢
      split
      · rename_i hr
        simp [hr] at hc
      · rfl
    | merge ms => rfl
    | missing i =>
      simp only [hd] at ha hb ⊢
      cases hr : recordedMerge (reqOf q) s q.coll q.group with
      | none => rfl
      | some ms =>
        simp only [hr] at ha hb
        split at ha <;> simp_all
    | assumed i =>
      simp only [hd] at ha hb ⊢
      cases hr : recordedMerge (reqOf q) s q.coll q.group with
      | none => rfl
      | some ms =>
        simp only [hr] at ha hb
        split at ha <;> simp_all
    | fullScan i => rfl

theorem guardOf_off_gate {q : Query} {s : ISet} {p : Policy} {e : Edition}
    (h : gate q p e = false) : guardOf q s p e = .none := by
  unfold guardOf
  simp [h]

/-- Outside the gate the head answer is the base answer. -/
theorem head_eq_base_off_gate {q : Query} {s : ISet} {p : Policy} {e : Edition}
    (h : gate q p e = false) : decideHead q s p e = decideBase q s p e := by
  unfold decideHead
  simp [h]

theorem head_eq_base_emulator (q : Query) (s : ISet) (e : Edition) :
    decideHead q s .emulator e = decideBase q s .emulator e :=
  head_eq_base_off_gate (by simp [gate, Policy.productionRules])

theorem head_eq_base_enterprise (q : Query) (s : ISet) (p : Policy) :
    decideHead q s p .enterprise = decideBase q s p .enterprise :=
  head_eq_base_off_gate (by simp [gate])

theorem head_eq_base_group (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (hg : q.group = true) : decideHead q s p e = decideBase q s p e :=
  head_eq_base_off_gate (by simp [gate, hg])

/-- What each override answers. -/
theorem head_override (q : Query) (s : ISet) (p : Policy) (e : Edition) :
    (guardOf q s p e = .c →
      decideHead q s p e = unservedDecision (reqOf q) q.coll q.group p e) ∧
    (guardOf q s p e = .a ∨ guardOf q s p e = .b →
      ∃ ms, recordedMerge (reqOf q) s q.coll q.group = some ms ∧
        decideHead q s p e = .merge ms) := by
  unfold decideHead guardOf
  cases hg : gate q p e
  · simp
  · simp only [Bool.not_true, Bool.false_eq_true, ite_false]
    cases hd : decideBase q s p e with
    | use i =>
      simp only
      split <;> simp
    | merge ms => simp
    | missing i =>
      simp only
      cases hr : recordedMerge (reqOf q) s q.coll q.group with
      | none => simp
      | some ms =>
        simp only
        split <;> simp
    | assumed i =>
      simp only
      cases hr : recordedMerge (reqOf q) s q.coll q.group with
      | none => simp
      | some ms =>
        simp only
        split <;> simp
    | fullScan i => simp

/-! ## The first attempt is kept -/

theorem wantedCount_one {r : Req} (h1 : r.eq.length = 1) (hc : r.contains = none) :
    wantedCount r = 1 := by
  simp [wantedCount, h1, hc]

/-- Whenever the base merge serves the query, the head answer is the base answer. -/
theorem first_attempt_kept (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (hm : (mergedIndexesFor (reqOf q) s q.coll q.group).isSome = true) :
    decideHead q s p e = decideBase q s p e := by
  cases hg : gate q p e
  · exact head_eq_base_off_gate hg
  · have hp : p.productionRules = true := by
      simp only [gate, Bool.and_eq_true] at hg
      exact hg.1.1.1
    unfold decideHead
    simp only [hg, Bool.not_true, Bool.false_eq_true, ite_false]
    cases hd : decideBase q s p e with
    | use i =>
      simp only
      split
      · rename_i hr
        exfalso
        simp only [refusesSingleEquality, Bool.and_eq_true, beq_iff_eq,
          Option.isNone_iff_eq_none] at hr
        obtain ⟨⟨⟨⟨⟨⟨⟨⟨_, hlen⟩, hcon⟩, _⟩, _⟩, _⟩, _⟩, _⟩, _⟩ := hr
        have hw := wantedCount_one hlen hcon
        rw [merged_refuses_few (by omega)] at hm
        simp at hm
      · rfl
    | merge ms => rfl
    | missing i | assumed i =>
      exfalso
      obtain ⟨ms, hms⟩ := Option.isSome_iff_exists.mp hm
      unfold decideBase decideQuery decideReq at hd
      revert hd
      cases automaticIndexFor (reqOf q) s q.coll q.group <;>
        cases s.composites.find? (fun i => compositeServes i (reqOf q) q.coll q.group) <;>
        simp [hp, hms]
    | fullScan i => rfl

/-- In particular a base merge is kept, with its members and their order. -/
theorem base_merge_kept (q : Query) (s : ISet) (p : Policy) (e : Edition) (ms : List Index)
    (h : decideBase q s p e = .merge ms) : decideHead q s p e = .merge ms := by
  unfold decideHead
  cases gate q p e <;> simp [h]

/-! ## Coverage by kind of the recorded merges -/

theorem mem_servedPrefix_fields {r : Req} {idx : Index} {f : Field}
    (h : f ∈ servedPrefix r idx) :
    ∃ fld ∈ idx.fields, fld.path = f ∧ fld.mode.ordered = true := by
  unfold servedPrefix at h
  obtain ⟨fld, hfld, rfl⟩ := List.mem_map.mp h
  have hP := List.all_eq_true.mp (List.all_takeWhile (l := idx.fields)
    (p := fun f => r.eq.contains f.path && f.mode.ordered)) fld hfld
  simp only [Bool.and_eq_true] at hP
  exact ⟨fld, List.takeWhile_subset _ hfld, rfl, hP.2⟩

theorem automaticMembers_spec {s : ISet} {coll : Nat} {group : Bool} {m : Mode}
    {fs : List Field} {ms : List Index} (h : automaticMembers s coll group m fs = some ms) :
    ms = fs.map fun f => singleFieldIndex coll group f m m := by
  unfold automaticMembers at h
  split at h
  · cases h; rfl
  · contradiction

theorem automatic_member_field {coll : Nat} {group : Bool} {m : Mode} {fs : List Field}
    {f : Field} (hf : f ∈ fs) (hm : m.ordered = true) :
    ∃ mi ∈ fs.map (fun f => singleFieldIndex coll group f m m),
      ∃ fld ∈ mi.fields, fld.path = f ∧ fld.mode.ordered = true :=
  ⟨singleFieldIndex coll group f m m, List.mem_map_of_mem hf, ⟨f, m⟩,
    by simp [singleFieldIndex], rfl, hm⟩

/-- A recorded merge covers every equality by a member with that field in an ordered mode, and
the array filter by a member with that field in contains mode. -/
theorem recorded_kinds {r : Req} {s : ISet} {coll : Nat} {group : Bool} {ms : List Index}
    (h : recordedMerge r s coll group = some ms) :
    (∀ f ∈ r.eq, ∃ m ∈ ms, ∃ fld ∈ m.fields, fld.path = f ∧ fld.mode.ordered = true) ∧
      (∀ t, r.contains = some t →
        ∃ m ∈ ms, ∃ fld ∈ m.fields, fld.path = t ∧ fld.mode = .contains) := by
  unfold recordedMerge at h
  split at h
  · contradiction
  · split at h
    · contradiction
    · rename_i t ht
      simp only at h
      split at h
      · -- (a)
        split at h
        · obtain ⟨ms0, hms0, rfl⟩ := Option.map_eq_some_iff.mp h
          rw [automaticMembers_spec hms0]
          refine ⟨fun f hf => ?_, fun t' ht' => ?_⟩
          · obtain ⟨mi, hmi, hfld⟩ :=
              automatic_member_field (coll := coll) (group := group) (m := .desc)
                (mem_sortFields.mpr hf) rfl
            exact ⟨mi, List.mem_cons_of_mem _ hmi, hfld⟩
          · rw [ht] at ht'
            cases ht'
            exact ⟨_, List.mem_cons_self, ⟨t, .contains⟩, by simp [singleFieldIndex], rfl, rfl⟩
        · contradiction
      · -- (b)
        split at h
        · contradiction
        split at h
        · rename_i idx hcar
          obtain ⟨ms0, hms0, rfl⟩ := Option.map_eq_some_iff.mp h
          rw [automaticMembers_spec hms0]
          have hmem : idx ∈ carryingComposites r s coll group t := by
            rw [hcar]; exact List.mem_singleton_self _
          unfold carryingComposites at hmem
          have hcond := (List.mem_filter.mp hmem).2
          simp only [Bool.and_eq_true, beq_iff_eq] at hcond
          refine ⟨fun f hf => ?_, fun t' ht' => ?_⟩
          · by_cases hsp : (servedPrefix r idx).contains f = true
            · obtain ⟨fld, hfld, hfp⟩ :=
                mem_servedPrefix_fields (List.contains_iff_mem.mp hsp)
              exact ⟨idx, List.mem_cons_self, fld, hfld, hfp⟩
            · have hnot : (!(servedPrefix r idx).contains f) = true := by simpa using hsp
              obtain ⟨mi, hmi, hfld⟩ :=
                automatic_member_field (coll := coll) (group := group) (m := .asc)
                  (fs := (sortFields r.eq).filter (fun f => !(servedPrefix r idx).contains f))
                  (List.mem_filter.mpr ⟨mem_sortFields.mpr hf, hnot⟩) rfl
              exact ⟨mi, List.mem_cons_of_mem _ hmi, hfld⟩
          · rw [ht] at ht'
            cases ht'
            exact ⟨idx, List.mem_cons_self, ⟨t, .contains⟩,
              List.mem_of_getElem? hcond.1.2, rfl, rfl⟩
        · contradiction

/-- A head merge is the base merge, or a recorded merge with coverage by kind. -/
theorem head_merge_kinds (q : Query) (s : ISet) (p : Policy) (e : Edition) (ms : List Index)
    (h : decideHead q s p e = .merge ms) :
    decideBase q s p e = .merge ms ∨
      (recordedMerge (reqOf q) s q.coll q.group = some ms ∧
        (∀ f ∈ (reqOf q).eq, ∃ m ∈ ms, ∃ fld ∈ m.fields, fld.path = f ∧ fld.mode.ordered = true) ∧
        (∀ t, (reqOf q).contains = some t →
          ∃ m ∈ ms, ∃ fld ∈ m.fields, fld.path = t ∧ fld.mode = .contains)) := by
  unfold decideHead at h
  cases hg : gate q p e
  · simp only [hg, Bool.not_false, ite_true] at h
    exact Or.inl h
  · simp only [hg, Bool.not_true, Bool.false_eq_true, ite_false] at h
    cases hd : decideBase q s p e with
    | use i =>
      rw [hd] at h
      simp only at h
      split at h
      · unfold unservedDecision at h
        simp only at h
        split at h
        · cases h
        · split at h <;> cases h
      · cases h
    | merge ms' =>
      rw [hd] at h
      exact Or.inl h
    | missing i | assumed i =>
      rw [hd] at h
      simp only at h
      cases hr : recordedMerge (reqOf q) s q.coll q.group with
      | none => rw [hr] at h; cases h
      | some ms' =>
        rw [hr] at h
        cases h
        exact Or.inr ⟨by simp, recorded_kinds hr⟩
    | fullScan i =>
      rw [hd] at h
      cases h

end IM
