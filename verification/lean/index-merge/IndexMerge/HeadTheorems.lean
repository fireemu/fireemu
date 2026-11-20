import IndexMerge.Head
import IndexMerge.Theorems

/-!
# Properties of the head decision

- `head_eq_base_outside_guards`: when no override fires (`guardOf` is none), the head answer is
  the base answer, verdict, members and their order, for the whole query;
  `head_eq_base_off_gate`, `head_eq_base_emulator`, `head_eq_base_enterprise`,
  `head_eq_base_group_outside_guards`: for the emulator policy, on Enterprise and at
  collection-group scope outside the recorded refusal and merge guards.
- `head_override`: what each override answers.
- `first_attempt_kept`: the head keeps a serving base merge outside the plan replacement guards.
- `recorded_kinds`, `head_merge_kinds`: a merge the recorded rules add covers every equality by
  a member with that field in an ordered mode and the array filter by a member with that field
  in contains mode.
-/

namespace IM

/-! ## Head and base agree outside the guards -/

/-- When none of the overrides (c), (a), (b) fires, the head answer is the base answer. -/
theorem head_eq_base_outside_guards (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (source : QuerySource)
    (ha : guardOf q s p e source ≠ .a) (hb : guardOf q s p e source ≠ .b)
    (hc : guardOf q s p e source ≠ .c) (hr : guardOf q s p e source ≠ .reverse)
    (hs : guardOf q s p e source ≠ .shared) (ht : guardOf q s p e source ≠ .carrier) :
    decideHead q s p e source = decideBase q s p e := by
  unfold decideHead
  unfold guardOf at ha hb hc hr hs ht
  cases hg : gate p e
  · simp
  · simp only [hg, Bool.not_true, Bool.false_eq_true, ite_false] at ha hb hc hr hs ht ⊢
    cases hd : decideBase q s p e with
    | use i =>
      simp only [hd] at hc ⊢
      split
      · rename_i hr
        simp [hr] at hc
      · rfl
    | merge ms =>
      simp only [hd] at hr hs ht ⊢
      cases hp : recordedPlan q s source ms with
      | none => rfl
      | some change => cases change <;> simp [hp, PlanChange.guard] at hr hs ht
    | missing i | assumed i =>
      cases hm : mergeGate q source
      · simp
      · simp only [hd, hm, ite_true] at ha hb ⊢
        cases hr : recordedMerge (reqOf q) s q.coll q.group with
        | none => rfl
        | some ms =>
          simp only [hr] at ha hb
          split at ha <;> simp_all
    | fullScan i => rfl

theorem guardOf_off_gate {q : Query} {s : ISet} {p : Policy} {e : Edition}
    (source : QuerySource) (h : gate p e = false) : guardOf q s p e source = .none := by
  unfold guardOf
  simp [h]

/-- Outside the gate the head answer is the base answer. -/
theorem head_eq_base_off_gate {q : Query} {s : ISet} {p : Policy} {e : Edition}
    (source : QuerySource) (h : gate p e = false) :
    decideHead q s p e source = decideBase q s p e := by
  unfold decideHead
  simp [h]

theorem head_eq_base_emulator (q : Query) (s : ISet) (e : Edition)
    (source : QuerySource) :
    decideHead q s .emulator e source = decideBase q s .emulator e :=
  head_eq_base_off_gate source (by simp [gate, Policy.productionRules])

theorem head_eq_base_enterprise (q : Query) (s : ISet) (p : Policy)
    (source : QuerySource) :
    decideHead q s p .enterprise source = decideBase q s p .enterprise :=
  head_eq_base_off_gate source (by simp [gate])

theorem head_eq_base_group_outside_guards
    (q : Query) (s : ISet) (p : Policy) (e : Edition) (source : QuerySource)
    (hg : q.group = true) (ha : guardOf q s p e source ≠ .a)
    (hb : guardOf q s p e source ≠ .b) (hc : guardOf q s p e source ≠ .c) :
    decideHead q s p e source = decideBase q s p e := by
  apply head_eq_base_outside_guards q s p e source ha hb hc
  all_goals
    unfold guardOf
    cases gate p e <;> cases decideBase q s p e <;> simp [recordedPlan, hg]
    all_goals split <;> (try simp_all)
    all_goals split <;> (try simp_all)
    all_goals split <;> simp_all

/-- With the recorded canonical shape, one equality requirement, and the base's automatic
mode unopposed by a serving composite, the override is the negation of the direction rule. -/
theorem recorded_refusal_iff_not_automatic_equality_serves
    (q : Query) (s : ISet) (i : Index) (f : IField) (source : QuerySource)
    (hshape : q.equalityRefusal source = true) (heq : (reqOf q).eq.length = 1)
    (harray : (reqOf q).contains = none)
    (horder : (reqOf q).order.all (·.path == NAME) = true)
    (hmode : i.fields.head? = some f)
    (hauto : automaticIndexFor (reqOf q) s q.coll q.group = some i)
    (hcomp : (s.composites.find? (fun c => compositeServes c (reqOf q) q.coll q.group)).isNone = true) :
    refusesSingleEquality q s i source = true ↔
      ¬ AutomaticEqualityServes f.mode (nameDirOf (reqOf q).order) := by
  simp [refusesSingleEquality, AutomaticEqualityServes, hshape, heq, harray, horder, hmode, hauto, hcomp]

/-- What each override answers. -/
theorem head_override (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (source : QuerySource) :
    (guardOf q s p e source = .c →
      decideHead q s p e source = unservedDecision (reqOf q) q.coll q.group p e) ∧
    (guardOf q s p e source = .a ∨ guardOf q s p e source = .b →
      ∃ ms, recordedMerge (reqOf q) s q.coll q.group = some ms ∧
        decideHead q s p e source = .merge ms) := by
  unfold decideHead guardOf
  cases hg : gate p e
  · simp
  · simp only [Bool.not_true, Bool.false_eq_true, ite_false]
    cases hd : decideBase q s p e with
    | use i =>
      simp only
      split <;> simp
    | merge ms =>
      cases hp : recordedPlan q s source ms with
      | none => simp [hp]
      | some change => cases change <;> simp [hp, PlanChange.guard]
    | missing i | assumed i =>
      cases mergeGate q source
      · simp
      · simp only [ite_true]
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

/-- Where the base merge serves and no recorded plan replacement applies, the head keeps it. -/
theorem first_attempt_kept (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (source : QuerySource)
    (hm : (mergedIndexesFor (reqOf q) s q.coll q.group).isSome = true)
    (hplan : ∀ ms, recordedPlan q s source ms = none) :
    decideHead q s p e source = decideBase q s p e := by
  cases hg : gate p e
  · exact head_eq_base_off_gate source hg
  · have hp : p.productionRules = true := by
      simp only [gate, Bool.and_eq_true] at hg
      exact hg.1
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
        obtain ⟨⟨⟨⟨⟨⟨_, hlen⟩, hcon⟩, _⟩, _⟩, _⟩, _⟩ := hr
        have hw := wantedCount_one hlen hcon
        rw [merged_refuses_few (by omega)] at hm
        simp at hm
      · rfl
    | merge ms => simp [hplan ms]
    | missing i | assumed i =>
      exfalso
      obtain ⟨ms, hms⟩ := Option.isSome_iff_exists.mp hm
      unfold decideBase decideQuery decideReq at hd
      revert hd
      cases automaticIndexFor (reqOf q) s q.coll q.group <;>
        cases s.composites.find? (fun i => compositeServes i (reqOf q) q.coll q.group) <;>
        simp [hp, hms]
    | fullScan i => rfl

/-- A base merge keeps its members and order outside the plan replacement guards. -/
theorem base_merge_kept (q : Query) (s : ISet) (p : Policy) (e : Edition) (ms : List Index)
    (source : QuerySource) (h : decideBase q s p e = .merge ms)
    (hp : recordedPlan q s source ms = none) :
    decideHead q s p e source = .merge ms := by
  unfold decideHead
  cases gate p e <;> simp [h, hp]

/-- Two or more related carriers preserve any served base merge for the implicit-order
carrier shape, including the base member order. -/
theorem multiple_related_carriers_keep_implicit_plan
    (q : Query) (s : ISet) (p : Policy) (e : Edition) (ms : List Index)
    (t : Field) (first second : Index) (rest : List Index)
    (horder : q.orderBy = []) (hgroup : q.group = false)
    (hcontains : (reqOf q).contains = some t)
    (hcarriers : relatedCarriers (reqOf q) s q.coll t = first :: second :: rest)
    (hbase : decideBase q s p e = .merge ms) :
    decideHead q s p e .plain = .merge ms := by
  apply base_merge_kept q s p e ms .plain hbase
  simp [recordedPlan, horder, hgroup, hcontains, hcarriers]
  exact fun _ two _ => two

/-- A lone related index outside the qualifying scope, prefix or suffix keeps the base
merge for the implicit-order carrier shape. -/
theorem unqualified_carrier_keeps_implicit_plan
    (q : Query) (s : ISet) (p : Policy) (e : Edition) (ms : List Index)
    (t : Field) (idx : Index)
    (horder : q.orderBy = []) (hgroup : q.group = false)
    (hcontains : (reqOf q).contains = some t)
    (hname : nameDirOf (reqOf q).order = .asc)
    (hrelated : relatedCarriers (reqOf q) s q.coll t = [idx])
    (hqualified : carryingComposites (reqOf q) s q.coll false t = [])
    (hbase : decideBase q s p e = .merge ms) :
    decideHead q s p e .plain = .merge ms := by
  apply base_merge_kept q s p e ms .plain hbase
  simp [recordedPlan, recordedMerge, horder, hgroup, hcontains, hname, hrelated, hqualified]
  exact fun _ two _ => two

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
        · rename_i idx hcar
          obtain ⟨ms0, hms0, rfl⟩ := Option.map_eq_some_iff.mp h
          rw [automaticMembers_spec hms0]
          have hmem : idx ∈ carryingComposites r s coll group t := by
            rw [hcar]; exact List.mem_singleton_self _
          unfold carryingComposites at hmem
          have hcond := (List.mem_filter.mp hmem).2
          simp only [relatedCarrier, Bool.and_eq_true, beq_iff_eq] at hcond
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
              List.mem_of_getElem? hcond.1.2.2, rfl, rfl⟩
        · contradiction

/-- A head merge is the base merge, the result of a recorded plan replacement of that merge,
or a recorded merge with coverage by kind. -/
theorem head_merge_kinds (q : Query) (s : ISet) (p : Policy) (e : Edition) (ms : List Index)
    (source : QuerySource) (h : decideHead q s p e source = .merge ms) :
    decideBase q s p e = .merge ms ∨
      (∃ before change, decideBase q s p e = .merge before ∧
        recordedPlan q s source before = some change ∧ change.members = ms) ∨
      (recordedMerge (reqOf q) s q.coll q.group = some ms ∧
        (∀ f ∈ (reqOf q).eq, ∃ m ∈ ms, ∃ fld ∈ m.fields, fld.path = f ∧ fld.mode.ordered = true) ∧
        (∀ t, (reqOf q).contains = some t →
          ∃ m ∈ ms, ∃ fld ∈ m.fields, fld.path = t ∧ fld.mode = .contains)) := by
  unfold decideHead at h
  cases hg : gate p e
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
      cases hp : recordedPlan q s source ms' with
      | none =>
        simp [hp] at h
        exact Or.inl (by simpa using congrArg Decision.merge h)
      | some change =>
        simp [hp, Function.comp_def] at h
        exact Or.inr (Or.inl ⟨ms', change, rfl, hp, h⟩)
    | missing i | assumed i =>
      cases hm : mergeGate q source
      · simp [hd, hm] at h
      · simp only [hd, hm, ite_true] at h
        cases hr : recordedMerge (reqOf q) s q.coll q.group with
        | none => rw [hr] at h; cases h
        | some ms' =>
          rw [hr] at h
          cases h
          exact Or.inr (Or.inr ⟨by simp, recorded_kinds hr⟩)
    | fullScan i =>
      rw [hd] at h
      cases h

end IM
