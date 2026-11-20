import SingleIndex.Model

namespace SI

private theorem ordered_iff (m : Mode) : m.isOrdered = true ↔ ∃ d, m = .ordered d := by
  cases m <;> simp [Mode.isOrdered]

theorem equality_prefix_iff (fixed : List Field) (eqs : List Path)
    (h : fixed.length = eqs.length) :
    equalityPrefix fixed eqs = true ↔ FixedKeys fixed eqs := by
  simp only [equalityPrefix, Bool.and_eq_true, List.all_eq_true, List.any_eq_true,
    List.contains_iff_mem, beq_iff_eq, ordered_iff, FixedKeys, h, true_and]
  simp only [List.mem_map, Prod.exists]
  constructor
  · rintro ⟨hl, hr⟩
    refine ⟨fun p => ⟨?_, ?_⟩, fun f hf => (hl f hf).2⟩
    · rintro ⟨x, m, hx, rfl⟩
      exact (hl (x, m) hx).1
    · intro hp
      exact hr p hp
  · rintro ⟨same, allOrdered⟩
    exact ⟨fun f hf => ⟨(same f.1).mp ⟨f.1, f.2, hf, rfl⟩, allOrdered f hf⟩,
      fun p hp => by
        obtain ⟨x, m, hx, rfl⟩ := (same p).mpr hp
        exact ⟨x, m, hx, rfl⟩⟩

private theorem after_array_append (a : Option Path) (tail : List Field) :
    afterArray (arrayKeys a ++ tail) a = some tail := by
  cases a <;> simp [arrayKeys, afterArray]

private theorem take_fixed (fixed tail : List Field) (eqs : List Path)
    (h : fixed.length = eqs.length) : (fixed ++ tail).take eqs.length = fixed := by
  rw [← h]
  simp

private theorem drop_fixed (fixed tail : List Field) (eqs : List Path)
    (h : fixed.length = eqs.length) : (fixed ++ tail).drop eqs.length = tail := by
  rw [← h]
  simp

private theorem filter_varying (order : List Clause) (h : ∀ o ∈ order, o.1 ≠ name) :
    (varyingKeys order).filter (·.1 != name) = varyingKeys order := by
  simp only [List.filter_eq_self, varyingKeys, List.mem_map, forall_exists_index, and_imp]
  rintro _ o ho rfl
  simpa using h o ho

private theorem find_name_varying (order : List Clause) (h : ∀ o ∈ order, o.1 ≠ name) :
    (varyingKeys order).find? (·.1 == name) = none := by
  simp only [List.find?_eq_none, varyingKeys, List.mem_map, forall_exists_index, and_imp,
    beq_iff_eq]
  rintro _ o ho rfl
  exact h o ho

private theorem suffix_explicit (r : Requirement) (ys : List Field) (d : Direction)
    (h : ∀ f ∈ ys, f.1 ≠ name) :
    suffixServes (ys ++ [key d]) r = true ↔
      ys = orderFields r ∧ d = requestedName r := by
  have hf : ys.filter (·.1 != name) = ys := by simpa [List.filter_eq_self] using h
  have hn : ys.find? (·.1 == name) = none := by simpa using h
  simp [suffixServes, List.filter_append, List.find?_append, hf, hn, key]

private theorem implicitTie_append_order (fixed : List Field) (order : List Clause)
    (o : Clause) (hl : order.getLast? = some o) :
    implicitTie (fixed ++ varyingKeys order) = o.2 := by
  obtain ⟨before, rfl⟩ := List.getLast?_eq_some_iff.mp hl
  simp [implicitTie, varyingKeys]

theorem composite_complete (i : Index) (r : Requirement) (coll : String) (scope : Scope)
    (h : Serves i coll scope r.equality r.array (nonNameOrder r) (requestedName r)) :
    compositeServes i r coll scope = true := by
  obtain ⟨hc, hs, fixed, suffix, hf, hfixed, ho, ht⟩ := h
  have hlen := hfixed.1
  have hpre := (equality_prefix_iff fixed r.equality hlen).mpr hfixed
  have hdrop : i.fields.drop r.equality.length =
      arrayKeys r.array ++ (orderFields r ++ suffix) := by
    rw [hf, List.append_assoc, List.append_assoc, drop_fixed _ _ _ hlen]
    rfl
  have htake : i.fields.take r.equality.length = fixed := by
    rw [hf, List.append_assoc, List.append_assoc, take_fixed _ _ _ hlen]
  have hbound : r.equality.length ≤ i.fields.length := by simp [hf, ← hlen]
  simp only [compositeServes, compositeFieldsServe, hc, hs, beq_self_eq_true, true_and,
    hbound, decide_true, htake, hpre, hdrop, after_array_append, Option.any_some,
    Bool.and_eq_true]
  refine ⟨?_, ?_⟩
  · cases scope <;> decide
  · change suffixServes (varyingKeys (nonNameOrder r) ++ suffix) r = true
    rcases ht with rfl | ⟨rfl, ht⟩
    · exact (suffix_explicit r _ _ (by
        intro f hf
        obtain ⟨o, hm, rfl⟩ := List.mem_map.mp hf
        exact ho o hm)).mpr ⟨rfl, rfl⟩
    · simp only [List.append_nil, suffixServes, filter_varying _ ho, find_name_varying _ ho,
        Option.none_or]
      cases hl : (nonNameOrder r).getLast? with
      | none => simp [varyingKeys, orderFields, List.getLast?_map, hl]
      | some o =>
        simp [varyingKeys, orderFields, List.getLast?_map, hl,
          ht.trans (implicitTie_append_order _ _ o hl)]

/-- The two predicates coincide for the requested scope with a clean trailing explicit
name. The converse without the layout and scope hypotheses has counterexamples. -/
theorem composite_explicit_iff (i : Index) (r : Requirement) (coll : String) (scope : Scope)
    (fixed ys : List Field) (d : Direction)
    (layout : i.fields = fixed ++ arrayKeys r.array ++ ys ++ [key d])
    (hlen : fixed.length = r.equality.length) (hs : i.scope = scope)
    (hclean : ∀ f ∈ ys, f.1 ≠ name) :
    compositeServes i r coll scope = true ↔
      Serves i coll scope r.equality r.array (nonNameOrder r) (requestedName r) := by
  refine ⟨fun h => ?_, composite_complete i r coll scope⟩
  have hbound : r.equality.length ≤ i.fields.length := by simp [layout, ← hlen]
  have htake : i.fields.take r.equality.length = fixed := by
    rw [layout, List.append_assoc, List.append_assoc, take_fixed _ _ _ hlen]
  have hdrop : i.fields.drop r.equality.length = arrayKeys r.array ++ (ys ++ [key d]) := by
    rw [layout, List.append_assoc, List.append_assoc, drop_fixed _ _ _ hlen]
  simp only [compositeServes, compositeFieldsServe, hbound, decide_true, htake, hdrop,
    after_array_append, Option.any_some, Bool.and_eq_true, beq_iff_eq, and_true] at h
  obtain ⟨⟨⟨hc, _⟩, hp⟩, ht⟩ := h
  obtain ⟨hy, hd⟩ := (suffix_explicit r _ _ hclean).mp ht
  refine ⟨hc, hs, fixed, [key d], ?_, (equality_prefix_iff _ _ hlen).mp hp, ?_, Or.inl ?_⟩
  · simpa [orderFields, varyingKeys] using layout.trans (congrArg (fun l => fixed ++ arrayKeys r.array ++ l ++ [key d]) hy)
  · intro o ho
    simpa [nonNameOrder] using (List.mem_filter.mp ho).2
  · rw [hd]

theorem required_index_serves (r : Requirement) (coll : String) (scope : Scope)
    (orders : List Clause) (dir : Direction)
    (h : r.order = orders ++ [(name, dir)]) (clean : ∀ o ∈ orders, o.1 ≠ name) :
    Serves (requiredIndex r coll scope) coll scope r.equality r.array orders dir := by
  refine ⟨rfl, rfl, (sortPaths r.equality).map (·, ascending), [key dir],
    ?_, ?_, clean, Or.inl rfl⟩
  · simp [requiredIndex, h, varyingKeys, arrayKeys, key, List.map_append, List.append_assoc]
  · simp [FixedKeys, sortPaths, ascending, List.mem_mergeSort]

theorem required_index_accepted (r : Requirement) (coll : String) (scope : Scope)
    (orders : List Clause) (dir : Direction)
    (h : r.order = orders ++ [(name, dir)]) (clean : ∀ o ∈ orders, o.1 ≠ name) :
    compositeServes (requiredIndex r coll scope) r coll scope = true := by
  have hf : orders.filter (·.1 != name) = orders := by
    simpa [List.filter_eq_self] using clean
  have hn : orders.find? (·.1 == name) = none := by simpa using clean
  apply composite_complete
  simpa [nonNameOrder, requestedName, h, List.filter_append, List.find?_append, hf, hn] using
    required_index_serves r coll scope orders dir h clean

theorem capacity_and_necessity_iff (i : Index) :
    (checkCapacity i = none ∧ checkNecessary i = none) ↔ CanCreate i := by
  simp only [checkCapacity, checkNecessary, CanCreate]
  by_cases h₁ : i.fields.length ≤ 100
  · by_cases h₂ : (i.fields.filter (·.2 == .contains)).length ≤ 1
    · simp [show ¬ i.fields.length > 100 by omega,
        show ¬ (i.fields.filter (·.2 == .contains)).length > 1 by omega, h₂, h₁]
      by_cases hs : i.fields.length < 2
      · simp [hs, show ¬ 2 ≤ i.fields.length by omega]
        grind
      · simp [hs, show 2 ≤ i.fields.length by omega]
    · simp [show ¬ i.fields.length > 100 by omega, h₁, h₂,
        show (i.fields.filter (·.2 == .contains)).length > 1 by omega]
  · simp [show i.fields.length > 100 by omega, h₁]

theorem required_index_creatable (r : Requirement) (coll : String) (scope : Scope)
    (orders : List Clause) (dir : Direction)
    (h : r.order = orders ++ [(name, dir)])
    (capacity : r.equality.length + r.array.toList.length + orders.length + 1 ≤ 100) :
    checkCapacity (requiredIndex r coll scope) = none ∧
      checkNecessary (requiredIndex r coll scope) = none := by
  apply (capacity_and_necessity_iff _).mpr
  unfold CanCreate
  have hlen : (requiredIndex r coll scope).fields.length =
      r.equality.length + r.array.toList.length + orders.length + 1 := by
    simp [requiredIndex, sortPaths, h, Nat.add_assoc]
  refine ⟨hlen ▸ capacity, ?_, Or.inr (Or.inl ⟨key dir, ?_, rfl⟩)⟩
  · have noContains (d : Direction) : (Mode.ordered d == .contains) = false := by
      cases d <;> rfl
    cases ha : r.array <;>
      simp [requiredIndex, h, ha, ascending, List.filter_append, List.filter_map,
        Function.comp_def, noContains]
    all_goals rw [List.filter_eq_nil_iff.mpr (by simp), List.filter_eq_nil_iff.mpr (by simp)]
    all_goals decide
  · simp [requiredIndex, h, key]

private theorem not_exempt_if_has_mode {modes : Modes} {scope : Scope} {m : Mode}
    (h : hasMode modes scope m = true) : isExempt modes scope = false := by
  have hp : (scope, m) ∈ modes := by simpa [hasMode] using h
  simp [isExempt, List.any_eq_true, show ∃ t ∈ modes, t.1 = scope from ⟨_, hp, rfl⟩]

theorem automatic_single_iff (r : Requirement) (lookup : Overrides) (coll : String)
    (scope : Scope) (p : Path) (h : touched r = [p]) :
    (automaticIndexFor r lookup coll scope).isSome = true ↔
      ∃ m ∈ automaticChoices r p, (scope, m) ∈ singleFieldModes lookup coll p := by
  constructor
  · intro ha
    simp only [automaticIndexFor, h] at ha
    split at ha
    · simp at ha
    · simpa [hasMode] using ha
  · rintro ⟨m, hm, he⟩
    have hb : hasMode (singleFieldModes lookup coll p) scope m = true := by
      simpa [hasMode] using he
    simp [automaticIndexFor, h, not_exempt_if_has_mode hb,
      List.find?_isSome.mpr ⟨m, hm, hb⟩]

theorem automatic_mono (r : Requirement) (old new : Overrides) (coll : String) (scope : Scope)
    (extendsModes : ∀ f, singleFieldModes old coll f ⊆ singleFieldModes new coll f)
    (h : (automaticIndexFor r old coll scope).isSome = true) :
    (automaticIndexFor r new coll scope).isSome = true := by
  cases ht : touched r with
  | nil => simpa [automaticIndexFor, ht] using h
  | cons f rest =>
    cases rest with
    | nil =>
      obtain ⟨m, hm, he⟩ := (automatic_single_iff r old coll scope f ht).mp h
      exact (automatic_single_iff r new coll scope f ht).mpr ⟨m, hm, extendsModes f he⟩
    | cons g rest => simp [automaticIndexFor, ht] at h

theorem automatic_scope (r : Requirement) (lookup : Overrides) (coll : String) (scope : Scope)
    (i : Index) (h : automaticIndexFor r lookup coll scope = some i) :
    i.scope = scope ∧ i.collection = coll := by
  cases ht : touched r with
  | nil =>
    cases hd : requestedName r <;> simp [automaticIndexFor, ht, hd] at h
    subst i
    exact ⟨rfl, rfl⟩
  | cons p rest =>
    cases rest with
    | nil =>
      simp only [automaticIndexFor, ht] at h
      split at h
      · simp at h
      · cases hf : (automaticChoices r p).find? (hasMode (singleFieldModes lookup coll p) scope) <;>
          simp [hf] at h
        subst i
        exact ⟨rfl, rfl⟩
    | cons q more => simp [automaticIndexFor, ht] at h

theorem composite_collection_cannot_serve_group (fields : List Field) (r : Requirement) :
    compositeFieldsServe fields .collection true .group r = false := by
  simp [compositeFieldsServe]

def equalityOnly (p : Path) (d : Direction) : Requirement := ⟨[p], none, [(name, d)], false⟩
def membershipOnly (p : Path) (d : Direction) : Requirement := ⟨[], some p, [(name, d)], false⟩
def orderOnly (p : Path) (d tie : Direction) : Requirement := ⟨[], none, [(p, d), (name, tie)], false⟩
def overlapping (p : Path) (d : Direction) : Requirement := ⟨[p], some p, [(name, d)], false⟩

theorem equality_only_rules (p : Path) (hp : p ≠ name) (d : Direction) (lookup : Overrides)
    (coll : String) (s : Scope) (m : Mode) :
    (compositeServes (singleFieldIndex coll s p m d) (equalityOnly p d) coll s = true ↔
      m.isOrdered = true) ∧
    ((automaticIndexFor (equalityOnly p d) lookup coll s).isSome = true ↔
      ∃ mode, mode.isOrdered = true ∧ (s, mode) ∈ singleFieldModes lookup coll p) := by
  constructor
  · cases s <;> simp [compositeServes, singleFieldIndex, compositeFieldsServe, equalityOnly,
      afterArray, equalityPrefix, suffixServes, orderFields, nonNameOrder, requestedName, key]
  · have ht : touched (equalityOnly p d) = [p] := by
      simp [touched, equalityOnly, nonNameOrder, List.eraseDups, List.eraseDupsBy, List.eraseDupsBy.loop]
    rw [automatic_single_iff _ _ _ _ _ ht]
    have hnp : name ≠ p := Ne.symm hp
    have hm (m : Mode) : m.isOrdered = true ↔ m = ascending ∨ m = descending := by
      cases m with
      | ordered dir => cases dir <;> decide
      | contains => decide
      | vector n => simp [Mode.isOrdered, ascending, descending]
    cases d <;> simp [automaticChoices, equalityOnly, requestedName, hnp, hm, ascending,
      descending] <;> grind

theorem membership_only_rules (p : Path) (hp : p ≠ name) (d : Direction) (lookup : Overrides)
    (coll : String) (s : Scope) (m : Mode) :
    (compositeServes (singleFieldIndex coll s p m d) (membershipOnly p d) coll s = true ↔
      m = .contains) ∧
    ((automaticIndexFor (membershipOnly p d) lookup coll s).isSome = true ↔
      (s, .contains) ∈ singleFieldModes lookup coll p) := by
  have ht : touched (membershipOnly p d) = [p] := by
    simp [touched, membershipOnly, nonNameOrder, List.eraseDups, List.eraseDupsBy, List.eraseDupsBy.loop]
  constructor
  · by_cases hm : m = .contains <;> cases s <;>
      simp [compositeServes, singleFieldIndex, compositeFieldsServe, membershipOnly,
        afterArray, equalityPrefix, suffixServes, orderFields, nonNameOrder, requestedName, key, hm]
  · rw [automatic_single_iff _ _ _ _ _ ht]
    simp [automaticChoices, membershipOnly, Ne.symm hp]

theorem order_only_rules (p : Path) (hp : p ≠ name) (d tie : Direction)
    (lookup : Overrides) (coll : String) (s : Scope) (m : Mode) :
    (compositeServes (singleFieldIndex coll s p m tie) (orderOnly p d tie) coll s = true ↔
      m = .ordered d) ∧
    ((automaticIndexFor (orderOnly p d tie) lookup coll s).isSome = true ↔
      d = tie ∧ (s, .ordered d) ∈ singleFieldModes lookup coll p) := by
  have ht : touched (orderOnly p d tie) = [p] := by simp [touched, orderOnly, nonNameOrder, hp, List.eraseDups, List.eraseDupsBy, List.eraseDupsBy.loop]
  constructor
  · cases s <;> simp [compositeServes, singleFieldIndex, compositeFieldsServe, orderOnly,
      afterArray, equalityPrefix, suffixServes, orderFields, nonNameOrder, requestedName, hp, key]
  · rw [automatic_single_iff _ _ _ _ _ ht]
    by_cases hd : d = tie <;> simp [automaticChoices, orderOnly, requestedName, hp, hd]

theorem overlapping_kinds (p : Path) (hp : p ≠ name) (d : Direction)
    (lookup : Overrides) (coll : String) (s : Scope) (m : Mode) :
    compositeServes (singleFieldIndex coll s p m d) (overlapping p d) coll s = false ∧
    ((automaticIndexFor (overlapping p d) lookup coll s).isSome = true ↔
      (s, .contains) ∈ singleFieldModes lookup coll p) := by
  have ht : touched (overlapping p d) = [p] := by simp [touched, overlapping, nonNameOrder, List.eraseDups, List.eraseDupsBy, List.eraseDupsBy.loop]
  constructor
  · cases s <;> simp [compositeServes, singleFieldIndex, compositeFieldsServe, overlapping,
      afterArray, equalityPrefix, suffixServes, orderFields, nonNameOrder, requestedName, key]
  · rw [automatic_single_iff _ _ _ _ _ ht]
    simp [automaticChoices, overlapping, Ne.symm hp]

def Decision.isIndexed : Decision → Bool
  | .useIndex _ | .merge _ => true
  | _ => false

private theorem unserved_unindexed (r : Requirement) (coll : String) (s : Scope)
    (p : Policy) (e : Edition) : (unserved r coll s p e).isIndexed = false := by
  cases p <;> cases e <;> rfl

theorem base_priority (r : Requirement) (lookup : Overrides) (coll : String) (scope : Scope)
    (cs : List Index) (p : Policy) (e : Edition) (m : Option (List Index)) :
    decideBase r lookup coll scope cs p e m =
      if let some i := automaticIndexFor r lookup coll scope then .useIndex i
      else if let some i := firstComposite r coll scope cs then .useIndex i
      else if let some members := m.filter (fun _ => p != .emulator) then .merge members
      else unserved r coll scope p e := by
  cases p <;> cases m <;> cases ha : automaticIndexFor r lookup coll scope <;>
    cases hc : firstComposite r coll scope cs <;> simp [decideBase, ha, hc, Option.filter]

theorem base_indexed_iff (r : Requirement) (lookup : Overrides) (coll : String)
    (scope : Scope) (cs : List Index) (p : Policy) (e : Edition) (m : Option (List Index)) :
    (decideBase r lookup coll scope cs p e m).isIndexed = true ↔
      (automaticIndexFor r lookup coll scope).isSome = true ∨
      (∃ i ∈ cs, compositeServes i r coll scope = true) ∨
      (p ≠ .emulator ∧ m.isSome = true) := by
  simp only [base_priority]
  cases ha : automaticIndexFor r lookup coll scope <;>
    cases hc : firstComposite r coll scope cs <;> cases m <;> cases p <;>
    (have h := List.find?_isSome (xs := cs) (p := (compositeServes · r coll scope))
     change (firstComposite r coll scope cs).isSome = true ↔ _ at h
     rw [hc] at h
     simp only [Option.filter]
     simp_all [unserved, Decision.isIndexed] <;> grind)

theorem base_monotone (r : Requirement) (old new : Overrides) (coll : String) (s : Scope)
    (cs ds : List Index) (p : Policy) (e : Edition) (m n : Option (List Index))
    (extendsModes : ∀ f, singleFieldModes old coll f ⊆ singleFieldModes new coll f)
    (extendsComposites : cs ⊆ ds) (mergePersists : m.isSome = true → n.isSome = true)
    (indexed : (decideBase r old coll s cs p e m).isIndexed = true) :
    (decideBase r new coll s ds p e n).isIndexed = true := by
  rw [base_indexed_iff] at indexed ⊢
  rcases indexed with h | ⟨i, hi, hs⟩ | ⟨hp, hm⟩
  · exact Or.inl (automatic_mono r old new coll s extendsModes h)
  · exact Or.inr (Or.inl ⟨i, extendsComposites hi, hs⟩)
  · exact Or.inr (Or.inr ⟨hp, mergePersists hm⟩)

theorem head_refusal_iff (r : Requirement) (lookup : Overrides) (coll : String) (s : Scope)
    (cs : List Index) (p : Policy) (e : Edition) (conjunction single : Bool)
    (baseMerge recordedMerge : Option (List Index))
    (h : (decideBase r lookup coll s cs p e baseMerge).isIndexed = true) :
    (decideHead r lookup coll s cs p e conjunction single baseMerge recordedMerge).isIndexed =
        false ↔
      stageB p e = true ∧
      ∃ i, decideBase r lookup coll s cs p e baseMerge = .useIndex i ∧
        refusesSingleEquality r lookup coll s cs conjunction single i = true := by
  cases hb : decideBase r lookup coll s cs p e baseMerge with
  | useIndex i =>
    cases hg : stageB p e <;>
      simp [decideHead, hb, hg, Decision.isIndexed]
    cases hr : refusesSingleEquality r lookup coll s cs conjunction single i
    · simp
    · exact unserved_unindexed r coll s p e
  | merge indexes => simp [decideHead, hb, Decision.isIndexed]
  | missing i | assumed i | fullScan i => simp [hb, Decision.isIndexed] at h

theorem composite_implicit_iff (i : Index) (r : Requirement) (coll : String) (scope : Scope)
    (fixed ys : List Field) (layout : i.fields = fixed ++ arrayKeys r.array ++ ys)
    (hlen : fixed.length = r.equality.length) (hs : i.scope = scope)
    (hclean : ∀ f ∈ ys, f.1 ≠ name)
    (hempty : ys = [] → requestedName r = implicitTie (fixed ++ arrayKeys r.array)) :
    compositeServes i r coll scope = true ↔
      Serves i coll scope r.equality r.array (nonNameOrder r) (requestedName r) := by
  refine ⟨fun h => ?_, composite_complete i r coll scope⟩
  have hbound : r.equality.length ≤ i.fields.length := by simp [layout, ← hlen]
  have htake : i.fields.take r.equality.length = fixed := by
    rw [layout, List.append_assoc, take_fixed _ _ _ hlen]
  have hdrop : i.fields.drop r.equality.length = arrayKeys r.array ++ ys := by
    rw [layout, List.append_assoc, drop_fixed _ _ _ hlen]
  simp only [compositeServes, compositeFieldsServe, hbound, decide_true, htake, hdrop,
    after_array_append, Option.any_some, Bool.and_eq_true, beq_iff_eq, and_true] at h
  obtain ⟨⟨⟨hc, _⟩, hp⟩, ht⟩ := h
  have hf : ys.filter (·.1 != name) = ys := by simpa [List.filter_eq_self] using hclean
  have hn : ys.find? (·.1 == name) = none := by simpa using hclean
  simp only [suffixServes, hf, hn, Option.none_or, Bool.and_eq_true, beq_iff_eq] at ht
  obtain ⟨hy, hm⟩ := ht
  change ys = varyingKeys (nonNameOrder r) at hy
  refine ⟨hc, hs, fixed, [], ?_, (equality_prefix_iff _ _ hlen).mp hp, ?_, Or.inr ⟨rfl, ?_⟩⟩
  · simpa [hy] using layout
  · intro o ho
    simpa [nonNameOrder] using (List.mem_filter.mp ho).2
  · cases hl : (nonNameOrder r).getLast? with
    | none =>
      have he : nonNameOrder r = [] := List.getLast?_eq_none_iff.mp hl
      simpa [he, varyingKeys] using hempty (by simp [hy, he, varyingKeys])
    | some o =>
      rw [implicitTie_append_order _ _ o hl]
      have hm' : o.2 = requestedName r := by
        simpa [hy, varyingKeys, List.getLast?_map, hl] using hm
      exact hm'.symm

def flipField (f : Field) : Field := (f.1, f.2.flip)
def flipClause (o : Clause) : Clause := (o.1, o.2.flip)

def flipRequirement (r : Requirement) : Requirement :=
  { r with order := (nonNameOrder r).map flipClause ++ [(name, (requestedName r).flip)] }

private theorem flip_mode_eq (m n : Mode) : (m.flip == n.flip) = (m == n) := by
  apply Bool.eq_iff_iff.mpr
  simp only [beq_iff_eq]
  exact ⟨fun hn => by simpa using congrArg Mode.flip hn, congrArg Mode.flip⟩

private theorem after_array_flip (fields : List Field) (arr : Option Path) :
    afterArray (fields.map flipField) arr = (afterArray fields arr).map (List.map flipField) := by
  cases arr with
  | none => rfl
  | some p =>
    cases fields with
    | nil => rfl
    | cons f fs =>
      rcases f with ⟨path, m⟩
      cases m <;> simp [afterArray, flipField, Mode.flip]

private theorem suffix_flip (r : Requirement) (fs : List Field) :
    suffixServes (fs.map flipField) (flipRequirement r) = suffixServes fs r := by
  have hn : ∀ o ∈ (nonNameOrder r).map flipClause, o.1 ≠ name := by
    intro o ho
    obtain ⟨orig, horig, rfl⟩ := List.mem_map.mp ho
    simpa [nonNameOrder, flipClause] using (List.mem_filter.mp horig).2
  have hf : ((nonNameOrder r).map flipClause).filter (·.1 != name) =
      (nonNameOrder r).map flipClause := by simpa [List.filter_eq_self] using hn
  have hfind : ((nonNameOrder r).map flipClause).find? (·.1 == name) = none := List.find?_eq_none.mpr (by simpa only [beq_iff_eq] using hn)
  have horder : orderFields (flipRequirement r) = (orderFields r).map flipField := by
    unfold orderFields
    have he : nonNameOrder (flipRequirement r) = (nonNameOrder r).map flipClause := by
      change ((nonNameOrder r).map flipClause ++ [(name, (requestedName r).flip)]).filter (·.1 != name) = _
      simp [List.filter_append, hf]
    rw [he, List.map_map, List.map_map]
    rfl
  have htie : requestedName (flipRequirement r) = (requestedName r).flip := by
    simp [requestedName, flipRequirement, List.find?_append, hfind]
  have inv (xs : List Field) : (xs.map flipField).map flipField = xs := by
    induction xs with
    | nil => rfl
    | cons a as ih => simp only [List.map_cons, ih, List.cons.injEq, and_true]; simp [flipField]
  have hmap (ls rs : List Field) : (ls.map flipField == rs.map flipField) = (ls == rs) := by
    apply Bool.eq_iff_iff.mpr
    simp only [beq_iff_eq]
    exact ⟨fun he => by simpa only [inv] using congrArg (List.map flipField) he,
      congrArg (List.map flipField)⟩
  have hor (a b : Option Field) :
      (a.map flipField).or (b.map flipField) = (a.or b).map flipField := by cases a <;> rfl
  simp only [suffixServes, List.filter_map, List.find?_map, List.getLast?_map, hor,
    horder, htie, hmap, Option.map_map]
  change (_ && (((fs.find? (·.1 == name)).or (fs.filter (·.1 != name)).getLast?).map
    (fun f : Field => f.2.flip)).all (· == (Mode.ordered (requestedName r)).flip)) = _
  cases (fs.find? (·.1 == name)).or (fs.filter (·.1 != name)).getLast? <;>
    simp only [Option.map_none, Option.map_some, Option.all_none, Option.all_some, flip_mode_eq] <;> rfl

theorem composite_reversed (fields : List Field) (r : Requirement) (a q : Scope)
    (sameCollection : Bool) :
    compositeFieldsServe (fields.map flipField) a sameCollection q (flipRequirement r) =
      compositeFieldsServe fields a sameCollection q r := by
  have hp (fs : List Field) : equalityPrefix (fs.map flipField) r.equality =
      equalityPrefix fs r.equality := by
    have hmode (m : Mode) : m.flip.isOrdered = m.isOrdered := by cases m <;> rfl
    unfold equalityPrefix
    simp only [List.all_map, List.any_map, Function.comp_def, flipField, hmode]
  have he : (flipRequirement r).equality = r.equality := rfl
  have ha : (flipRequirement r).array = r.array := rfl
  simp only [compositeFieldsServe, he, ha, List.length_map, ← List.map_take, hp,
    ← List.map_drop, after_array_flip]
  cases afterArray (fields.drop r.equality.length) r.array <;> simp [suffix_flip]

theorem scan_filters_are_exact (d : Document) (fixed : List Field) (eqs : List Path)
    (arr : Option Path) (value : Path → Nat) (element : Nat) (h : FixedKeys fixed eqs) :
    matchesQuery d (fixed.map Prod.fst) arr value element ↔
      matchesQuery d eqs arr value element := by
  constructor
  · rintro ⟨sel, mem⟩
    exact ⟨fun p hp => sel p ((h.2.1 p).mpr hp), mem⟩
  · rintro ⟨sel, mem⟩
    exact ⟨fun p hp => sel p ((h.2.1 p).mp hp), mem⟩

private theorem compare_append_fixed (fixed rest : List Field) (left right : Document)
    (same : ∀ f ∈ fixed, left.value f.1 = right.value f.1) :
    lexCompare (fixed ++ rest) left right = lexCompare rest left right := by
  induction fixed with
  | nil => rfl
  | cons f fs ih =>
    rcases f with ⟨p, m⟩
    have hp : left.value p = right.value p := same (p, m) (by simp)
    have hrest := ih (fun f hf => same f (by simp [hf]))
    cases m with
    | ordered d => cases d <;> simp [lexCompare, hp, hrest]
    | contains | vector _ => exact hrest

/-- On matching documents the fixed and membership keys cannot change order. The
comparison reads the physical keys, extended by the implicit key when omitted. -/
theorem scan_order_is_exact (fields : List Field) (eqs : List Path) (arr : Option Path)
    (order : List Clause) (tie : Direction) (left right : Document)
    (scan : ScanKeys fields eqs arr order tie)
    (same : ∀ p ∈ eqs, left.value p = right.value p) :
    ∃ scanFields, (scanFields = fields ∨ scanFields = fields ++ [key tie]) ∧
      lexCompare scanFields left right = lexCompare (varyingKeys order ++ [key tie]) left right := by
  obtain ⟨fixed, suffix, hf, hfixed, _, htie⟩ := scan
  have heq : ∀ f ∈ fixed, left.value f.1 = right.value f.1 := fun f hf =>
    same f.1 ((hfixed.2.1 f.1).mp (List.mem_map.mpr ⟨f, hf, rfl⟩))
  refine ⟨fixed ++ arrayKeys arr ++ (varyingKeys order ++ [key tie]), ?_, ?_⟩
  · rcases htie with rfl | ⟨rfl, _⟩
    · left; simp [hf, List.append_assoc]
    · right; simp [hf, List.append_assoc]
  · rw [List.append_assoc fixed, compare_append_fixed _ _ _ _ heq]
    cases arr <;> rfl

theorem membership_with_order_needs_two_keys (p : Path) (hp : p ≠ name)
    (d tie : Direction) (lookup : Overrides) (coll : String) (s : Scope) (m : Mode) :
    let r : Requirement := ⟨[], some p, [(p, d), (name, tie)], false⟩
    automaticIndexFor r lookup coll s = none ∧
      compositeServes (singleFieldIndex coll s p m tie) r coll s = false := by
  dsimp only
  have ht : touched ⟨[], some p, [(p, d), (name, tie)], false⟩ = [p] := by
    simp [touched, nonNameOrder, hp, List.eraseDups, List.eraseDupsBy, List.eraseDupsBy.loop]
  constructor
  · simp [automaticIndexFor, ht, automaticChoices]
  · by_cases hm : m = .contains <;> cases s <;>
      simp [compositeServes, singleFieldIndex, compositeFieldsServe, afterArray, equalityPrefix,
        suffixServes, orderFields, nonNameOrder, requestedName, key, hm, hp]

theorem head_after_base_indexed_extension (r : Requirement) (old new : Overrides) (coll : String)
    (s : Scope) (cs ds : List Index) (p : Policy) (e : Edition) (m n rm : Option (List Index))
    (conjunction single : Bool)
    (extendsModes : ∀ f, singleFieldModes old coll f ⊆ singleFieldModes new coll f)
    (extendsComposites : cs ⊆ ds) (mergePersists : m.isSome = true → n.isSome = true)
    (indexed : (decideBase r old coll s cs p e m).isIndexed = true) :
    (decideHead r new coll s ds p e conjunction single n rm).isIndexed = false ↔
      stageB p e = true ∧
      ∃ i, decideBase r new coll s ds p e n = .useIndex i ∧
        refusesSingleEquality r new coll s ds conjunction single i = true :=
  head_refusal_iff r new coll s ds p e conjunction single n rm
    (base_monotone r old new coll s cs ds p e m n extendsModes extendsComposites mergePersists indexed)

theorem automatic_single_result (r : Requirement) (lookup : Overrides) (coll : String)
    (s : Scope) (p : Path) (i : Index) (ht : touched r = [p])
    (ha : automaticIndexFor r lookup coll s = some i) :
    ∃ m ∈ automaticChoices r p, (s, m) ∈ singleFieldModes lookup coll p ∧
      i = singleFieldIndex coll s p m (requestedName r) := by
  simp only [automaticIndexFor, ht] at ha
  split at ha
  · simp at ha
  · cases hf : (automaticChoices r p).find? (hasMode (singleFieldModes lookup coll p) s) with
    | none => simp [hf] at ha
    | some m =>
      simp [hf] at ha
      exact ⟨m, List.mem_of_find?_eq_some hf, by
        simpa [hasMode] using List.find?_some hf, ha.symm⟩

theorem automatic_regular_iff (r : Requirement) (lookup : Overrides) (coll : String)
    (s : Scope) (p : Path) (hp : p ≠ name) (tie : Direction)
    (regular : r = equalityOnly p tie ∨ r = membershipOnly p tie ∨ ∃ d, r = orderOnly p d tie) :
    (automaticIndexFor r lookup coll s).isSome = true ↔
      ∃ m, (s, m) ∈ singleFieldModes lookup coll p ∧
        AutomaticMode p m r.equality r.array (nonNameOrder r) tie := by
  rcases regular with rfl | rfl | ⟨d, rfl⟩
  · rw [(equality_only_rules p hp tie lookup coll s ascending).2]
    constructor
    · rintro ⟨m, hm, he⟩
      obtain ⟨d, rfl⟩ := (ordered_iff m).mp hm
      exact ⟨_, he, by simp [AutomaticMode, equalityOnly, nonNameOrder]⟩
    · rintro ⟨m, he, hm⟩
      cases m with
      | ordered d => exact ⟨_, rfl, he⟩
      | contains | vector _ => simp [AutomaticMode, equalityOnly] at hm
  · rw [(membership_only_rules p hp tie lookup coll s .contains).2]
    constructor
    · intro he
      exact ⟨_, he, by simp [AutomaticMode, membershipOnly, nonNameOrder]⟩
    · rintro ⟨m, he, hm⟩
      cases m with
      | contains => exact he
      | ordered _ | vector _ => simp [AutomaticMode, membershipOnly] at hm
  · rw [(order_only_rules p hp d tie lookup coll s ascending).2]
    constructor
    · rintro ⟨rfl, he⟩
      exact ⟨_, he, by simp [AutomaticMode, orderOnly, nonNameOrder, hp]⟩
    · rintro ⟨m, he, hm⟩
      cases m with
      | ordered d' =>
        simp [AutomaticMode, orderOnly, nonNameOrder, hp] at hm
        obtain ⟨rfl, ht⟩ := hm
        exact ⟨ht, he⟩
      | contains | vector _ => simp [AutomaticMode, orderOnly] at hm

theorem automatic_regular_result_serves (r : Requirement) (lookup : Overrides) (coll : String)
    (s : Scope) (p : Path) (hp : p ≠ name) (tie : Direction) (i : Index)
    (regular : r = equalityOnly p tie ∨ r = membershipOnly p tie ∨ ∃ d, r = orderOnly p d tie)
    (h : automaticIndexFor r lookup coll s = some i) :
    compositeServes i r coll s = true := by
  have ht : touched r = [p] := by
    rcases regular with rfl | rfl | ⟨d, rfl⟩ <;>
      simp [touched, equalityOnly, membershipOnly, orderOnly, nonNameOrder, hp,
        List.eraseDups, List.eraseDupsBy, List.eraseDupsBy.loop]
  obtain ⟨m, hm, _, rfl⟩ := automatic_single_result r lookup coll s p i ht h
  have hn : name ≠ p := Ne.symm hp
  rcases regular with rfl | rfl | ⟨d, rfl⟩
  · have hmode : m.isOrdered = true := by
      simp [automaticChoices, equalityOnly, hn] at hm
      rcases hm with rfl | rfl | rfl <;> rfl
    change compositeServes (singleFieldIndex coll s p m tie) (equalityOnly p tie) coll s = true
    exact (equality_only_rules p hp tie lookup coll s m).1.mpr hmode
  · have hmode : m = .contains := by simpa [automaticChoices, membershipOnly, hn] using hm
    change compositeServes (singleFieldIndex coll s p m tie) (membershipOnly p tie) coll s = true
    exact (membership_only_rules p hp tie lookup coll s m).1.mpr hmode
  · have hmode : m = .ordered d := by
      by_cases hd : d = tie
      · subst d
        simpa [automaticChoices, orderOnly, requestedName, hp] using hm
      · simp [automaticChoices, orderOnly, requestedName, hp, hd] at hm
    have htie : requestedName (orderOnly p d tie) = tie := by simp [requestedName, orderOnly, hp]
    rw [htie]
    exact (order_only_rules p hp d tie lookup coll s m).1.mpr hmode

end SI
