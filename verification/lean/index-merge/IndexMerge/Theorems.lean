import IndexMerge.Lemmas

/-!
# Properties of the merge decision

- `merged_sound`: a merge's members are members in the sense of `Member` (configured
  composites serving some equality fields with the same order, or enabled automatic indexes)
  and together cover every wanted field.
- `merged_iff_spec`: the algorithm (maximal equality prefixes, largest first, greedy cover)
  merges exactly when the declarative `MergeSpec` holds; `merged_none_iff` restates the refusal
  conditions, and `merged_refuses_few` and `merged_refuses_eq_ordered` are the documented ones.
- `merged_mono`, `decide_mono`: adding composites or enabling single-field modes never turns a
  served requirement into a refused one.
- `merged_perm`, `decide_served_perm`: whether a requirement is served does not depend on the
  order composites were added in (the members chosen do: `Counterexamples.lean`).
- `reqOf_wf`: every requirement built from a query satisfies `WF`.
-/

namespace IM

/-! ## Candidates -/

theorem mem_of_mem_servedPrefix {r : Req} {idx : Index} {x : Field}
    (h : x ∈ servedPrefix r idx) : x ∈ r.eq := by
  unfold servedPrefix at h
  obtain ⟨f, hf, rfl⟩ := List.mem_map.mp h
  have hall := List.all_eq_true.mp (List.all_takeWhile (l := idx.fields)
    (p := fun f => r.eq.contains f.path && f.mode.ordered)) f hf
  simp only [Bool.and_eq_true, List.contains_iff_mem] at hall
  exact hall.1

theorem compositeCandidates_mem {r : Req} {s : ISet} {coll : Nat} {group : Bool}
    {p : List Field × Index} (h : p ∈ compositeCandidates r s coll group) :
    p.2 ∈ s.composites ∧ p.1 = (servedPrefix r p.2).eraseDups ∧ servedPrefix r p.2 ≠ [] ∧
      compositeServes p.2 (subReq r (servedPrefix r p.2)) coll group = true := by
  unfold compositeCandidates at h
  obtain ⟨idx, hidx, hp⟩ := List.mem_filterMap.mp h
  simp only at hp
  split at hp
  · contradiction
  · rename_i hne
    split at hp
    · rename_i hserves
      cases hp
      exact ⟨hidx, rfl, fun h => hne (by simp [h]), hserves⟩
    · contradiction

theorem autoCandidates_mem {r : Req} {s : ISet} {coll : Nat} {group : Bool}
    {p : List Field × Index} (h : p ∈ autoCandidates r s coll group) :
    (∀ o ∈ r.order, o.path = NAME) ∧
      ((∃ f, f ∈ r.eq ∧ hasMode s coll f group (modeFor (nameDirOf r.order)) = true ∧
          p = ([f], singleFieldIndex coll group f (modeFor (nameDirOf r.order))
            (modeFor (nameDirOf r.order)))) ∨
        (∃ c, r.contains = some c ∧ nameDirOf r.order = .asc ∧
          hasMode s coll c group .contains = true ∧
          p = ([c], singleFieldIndex coll group c .contains .asc))) := by
  unfold autoCandidates at h
  split at h
  · rename_i hall
    have hall' : ∀ o ∈ r.order, o.path = NAME := by
      intro o ho
      simpa using (List.all_eq_true.mp hall) o ho
    refine ⟨hall', ?_⟩
    rcases List.mem_append.mp h with h | h
    · left
      obtain ⟨f, hf, hp⟩ := List.mem_filterMap.mp h
      split at hp
      · rename_i hc
        simp only [Bool.and_eq_true] at hc
        cases hp
        exact ⟨f, mem_sortFields.mp hf, hc.2, rfl⟩
      · contradiction
    · right
      split at h
      · rename_i c hc
        split at h
        · rename_i hcond
          simp only [Bool.and_eq_true, beq_iff_eq] at hcond
          have hdir : nameDirOf r.order = .asc := by
            have := hcond.1.1
            revert this
            cases nameDirOf r.order <;> simp [modeFor]
          simp only [List.mem_singleton] at h
          subst h
          refine ⟨c, hc, hdir, hcond.2, ?_⟩
          rw [hcond.1.1]
        · simp at h
      · simp at h
  · simp at h

/-- Every candidate is a member covering the candidate's fields. -/
theorem member_of_candidate {r : Req} {s : ISet} {coll : Nat} {group : Bool}
    {p : List Field × Index} (h : p ∈ candidates r s coll group) :
    ∃ S, Member r s coll group p.2 S ∧ ∀ x, x ∈ S ↔ x ∈ p.1 := by
  unfold candidates at h
  rcases List.mem_append.mp h with h | h
  · obtain ⟨hidx, hfields, hne, hserves⟩ := compositeCandidates_mem (mem_sortDesc.mp h)
    refine ⟨servedPrefix r p.2, .composite _ _ hidx hne (fun _ hx => mem_of_mem_servedPrefix hx)
      hserves, fun x => ?_⟩
    rw [hfields, List.mem_eraseDups]
  · obtain ⟨hall, (⟨f, hf, hm, rfl⟩ | ⟨c, hc, hdir, hm, rfl⟩)⟩ := autoCandidates_mem h
    · exact ⟨[f], .automatic f hf hall hm, fun _ => Iff.rfl⟩
    · exact ⟨[c], .arrayContains c hc hall hdir hm, fun _ => Iff.rfl⟩

theorem wanted_of_member {r : Req} {s : ISet} {coll : Nat} {group : Bool} {m : Index}
    {S : List Field} (h : Member r s coll group m S) : ∀ x ∈ S, Wanted r x := by
  cases h with
  | composite _ _ _ _ hS _ => exact fun x hx => Or.inl (hS x hx)
  | automatic f hf _ _ => intro x hx; simp at hx; subst hx; exact Or.inl hf
  | arrayContains c hc _ _ _ => intro x hx; simp at hx; subst hx; exact Or.inr hc

/-! ## A member's equality fields are exactly the composite's maximal equality prefix -/

theorem matchOrder_cons {f : IField} {fs : List IField} {os : List OrderC}
    (h : matchOrder (f :: fs) os ≠ none) : ∃ o os', os = o :: os' ∧ f.path = o.path := by
  cases os with
  | nil => simp [matchOrder] at h
  | cons o os' =>
    refine ⟨o, os', rfl, ?_⟩
    simp only [matchOrder] at h
    split at h
    · rename_i hc
      simp only [Bool.and_eq_true, beq_iff_eq] at hc
      exact hc.1
    · simp at h

theorem matchOrder_of_suffixServes {rest : List IField} {order : List OrderC}
    (h : suffixServes rest order = true) :
    matchOrder (rest.filter (·.path != NAME)) (order.filter (·.path != NAME)) ≠ none := by
  unfold suffixServes at h
  split at h
  · simp at h
  · rename_i last heq
    rw [heq]
    simp

theorem servedPrefix_of_serves {r : Req} (hwf : WF r) {idx : Index} {S : List Field}
    {coll : Nat} {group : Bool} (hS : ∀ x ∈ S, x ∈ r.eq)
    (h : compositeServes idx (subReq r S) coll group = true) :
    servedPrefix r idx = (idx.fields.take S.length).map (·.path) ∧ S.length ≤ idx.fields.length ∧
      ∀ x, x ∈ (idx.fields.take S.length).map (·.path) ↔ x ∈ S := by
  unfold compositeServes at h
  simp only [subReq, Bool.or_eq_true, bne_iff_ne, ne_eq, beq_iff_eq, Bool.and_eq_true] at h
  split at h
  · simp at h
  · rename_i hcoll
    split at h
    · simp at h
    · rename_i hlen
      split at h
      · simp at h
      · rename_i hany
        simp only [List.any_eq_true, Bool.not_eq_true', List.contains_iff_mem,
          not_or, not_exists, not_and, Bool.not_eq_false] at hany
        obtain ⟨⟨hpre, hcover⟩, hord⟩ := hany
        have hlen' : S.length ≤ idx.fields.length := by omega
        -- Every field of the prefix is an ordered equality field.
        have hP : ∀ f ∈ idx.fields.take S.length,
            (fun f : IField => r.eq.contains f.path && f.mode.ordered) f = true := by
          intro f hf
          have h1 : f.path ∈ S := by
            have := hpre f hf
            simpa using this
          have h2 : f.mode.ordered = true := by
            have := hord f hf
            simpa using this
          simp [hS _ h1, h2]
        -- No field after it is one: it would be the first ordered field, and orders name no
        -- equality field.
        have hstop : (idx.fields.drop S.length).takeWhile
            (fun f : IField => r.eq.contains f.path && f.mode.ordered) = [] := by
          cases hd : idx.fields.drop S.length with
          | nil => simp
          | cons f t =>
            rw [List.takeWhile_cons]
            split
            · rename_i hPf
              exfalso
              simp only [Bool.and_eq_true, List.contains_iff_mem] at hPf
              have hfn : f.path ≠ NAME := fun e => hwf.name_not_eq (e ▸ hPf.1)
              rw [hd] at h
              have hm := matchOrder_of_suffixServes h
              have hfilter : (f :: t).filter (·.path != NAME) = f :: t.filter (·.path != NAME) := by
                simp [hfn]
              rw [hfilter] at hm
              obtain ⟨o, os', hos, hpath⟩ := matchOrder_cons hm
              have ho : o ∈ r.order := by
                have : o ∈ r.order.filter (·.path != NAME) := by rw [hos]; exact List.mem_cons_self
                exact (List.mem_filter.mp this).1
              exact hwf.order_not_eq o ho (hpath ▸ hPf.1)
            · rfl
        refine ⟨?_, hlen', ?_⟩
        · have htw : idx.fields.takeWhile
              (fun f : IField => r.eq.contains f.path && f.mode.ordered) =
                idx.fields.take S.length := by
            conv => lhs; rw [← List.take_append_drop S.length idx.fields]
            rw [List.takeWhile_append_of_pos hP, hstop, List.append_nil]
          unfold servedPrefix
          rw [htw]
        · intro x
          constructor
          · intro hx
            obtain ⟨f, hf, rfl⟩ := List.mem_map.mp hx
            simpa using hpre f hf
          · intro hx
            obtain ⟨f, hf, hfx⟩ := hcover x hx
            exact List.mem_map.mpr ⟨f, hf, by simpa using hfx⟩

/-- Every member's fields are covered by one candidate. -/
theorem candidate_of_member {r : Req} (hwf : WF r) {s : ISet} {coll : Nat} {group : Bool}
    {m : Index} {S : List Field} (h : Member r s coll group m S) :
    ∃ q ∈ candidates r s coll group, ∀ x ∈ S, x ∈ q.1 := by
  cases h with
  | composite _ S hm hne hS hserves =>
    obtain ⟨hsp, hlen, hmem⟩ := servedPrefix_of_serves hwf hS hserves
    refine ⟨((servedPrefix r m).eraseDups, m), ?_, fun x hx => ?_⟩
    · unfold candidates
      apply List.mem_append_left
      apply mem_sortDesc.mpr
      unfold compositeCandidates
      apply List.mem_filterMap.mpr
      refine ⟨m, hm, ?_⟩
      have hspne : (servedPrefix r m).isEmpty = false := by
        rw [hsp]
        cases S with
        | nil => exact absurd rfl hne
        | cons y ys =>
          cases hf : m.fields with
          | nil => rw [hf] at hlen; simp at hlen
          | cons g gs => simp
      have hserves' : compositeServes m (subReq r (servedPrefix r m)) coll group = true := by
        rw [← hserves]
        apply compositeServes_congr
        · simp [subReq, hsp, List.length_take, Nat.min_eq_left hlen]
        · intro x; simp only [subReq]; rw [hsp]; exact hmem x
        · rfl
        · rfl
      simp only [hspne, hserves', ite_true]
      rfl
    · rw [List.mem_eraseDups, hsp]
      exact (hmem x).2 hx
  | automatic f hf hall hm =>
    refine ⟨([f], singleFieldIndex coll group f (modeFor (nameDirOf r.order))
      (modeFor (nameDirOf r.order))), ?_, fun x hx => hx⟩
    unfold candidates
    apply List.mem_append_right
    unfold autoCandidates
    have hall' : r.order.all (·.path == NAME) = true :=
      List.all_eq_true.mpr fun o ho => by simp [hall o ho]
    rw [ite_eq_left hall']
    apply List.mem_append_left
    apply List.mem_filterMap.mpr
    refine ⟨f, mem_sortFields.mpr hf, ?_⟩
    simp [not_exempt_of_hasMode hm, hm]
  | arrayContains c hc hall hdir hm =>
    refine ⟨([c], singleFieldIndex coll group c .contains .asc), ?_, fun x hx => hx⟩
    unfold candidates
    apply List.mem_append_right
    unfold autoCandidates
    have hall' : r.order.all (·.path == NAME) = true :=
      List.all_eq_true.mpr fun o ho => by simp [hall o ho]
    rw [ite_eq_left hall']
    apply List.mem_append_right
    simp [hc, hdir, modeFor, not_exempt_of_hasMode hm, hm]

/-! ## Soundness and the specification -/

theorem wanted_iff {r : Req} {x : Field} : x ∈ wanted r ↔ Wanted r x := by
  unfold wanted Wanted
  cases h : r.contains <;> simp [eq_comm]

/-- A merge's members are members, each covering wanted fields only, and together they cover
every wanted field. -/
theorem merged_sound {r : Req} {s : ISet} {coll : Nat} {group : Bool} {ms : List Index}
    (h : mergedIndexesFor r s coll group = some ms) :
    2 ≤ wantedCount r ∧ r.eqOrdered = false ∧
      (∀ m ∈ ms, ∃ S, Member r s coll group m S ∧ ∀ x ∈ S, Wanted r x) ∧
      ∀ x, Wanted r x → ∃ m ∈ ms, ∃ S, Member r s coll group m S ∧ x ∈ S := by
  unfold mergedIndexesFor at h
  dsimp only at h
  split at h
  · contradiction
  · rename_i hguard
    simp only [Bool.or_eq_true, decide_eq_true_eq, not_or, Bool.not_eq_true] at hguard
    split at h
    · rename_i hcov
      cases h
      obtain ⟨chosen, hsub, hms, hgreedy⟩ := greedy_spec [] (candidates r s coll group)
      refine ⟨by omega, hguard.2, ?_, ?_⟩
      · intro m hm
        rw [hms] at hm
        obtain ⟨p, hp, rfl⟩ := List.mem_map.mp hm
        obtain ⟨S, hmem, hS⟩ := member_of_candidate (hsub p hp)
        exact ⟨S, hmem, wanted_of_member hmem⟩
      · intro x hx
        simp only [Bool.and_eq_true, List.all_eq_true, decide_eq_true_eq] at hcov
        have hin := (hgreedy x).1 (hcov.1 x (wanted_iff.mpr hx))
        simp only [List.not_mem_nil, false_or] at hin
        obtain ⟨p, hp, hxp⟩ := hin
        obtain ⟨S, hmem, hS⟩ := member_of_candidate (hsub p hp)
        exact ⟨p.2, by rw [hms]; exact List.mem_map_of_mem hp, S, hmem, (hS x).2 hxp⟩
    · contradiction

/-- The algorithm merges exactly when the declarative specification holds. -/
theorem merged_iff_spec {r : Req} (hwf : WF r) (s : ISet) (coll : Nat) (group : Bool) :
    (mergedIndexesFor r s coll group).isSome = true ↔ MergeSpec r s coll group := by
  constructor
  · intro h
    obtain ⟨ms, hms⟩ := Option.isSome_iff_exists.mp h
    obtain ⟨h2, hord, _, hcov⟩ := merged_sound hms
    exact ⟨h2, hord, fun x hx => by
      obtain ⟨m, _, S, hm, hxS⟩ := hcov x hx
      exact ⟨m, S, hm, hxS⟩⟩
  · rintro ⟨h2, hord, hcov⟩
    unfold mergedIndexesFor
    dsimp only
    have hguard : (wantedCount r < 2 || r.eqOrdered) = false := by
      simp [hord]; omega
    simp only [hguard, Bool.false_eq_true, ite_false]
    have hall : (((wanted r).all fun x => decide (x ∈ (greedy [] (candidates r s coll group)).1)) &&
        ((greedy [] (candidates r s coll group)).1.all fun x => decide (x ∈ wanted r))) = true := by
      simp only [Bool.and_eq_true, List.all_eq_true, decide_eq_true_eq]
      constructor
      · intro x hx
        obtain ⟨m, S, hm, hxS⟩ := hcov x (wanted_iff.mp hx)
        obtain ⟨q, hq, hqS⟩ := candidate_of_member hwf hm
        exact greedy_covers [] _ q hq x (hqS x hxS)
      · intro x hx
        obtain ⟨chosen, hsub, _, hgreedy⟩ := greedy_spec [] (candidates r s coll group)
        have hin := (hgreedy x).1 hx
        simp only [List.not_mem_nil, false_or] at hin
        obtain ⟨p, hp, hxp⟩ := hin
        obtain ⟨S, hmem, hS⟩ := member_of_candidate (hsub p hp)
        exact wanted_iff.mpr (wanted_of_member hmem x ((hS x).2 hxp))
    simp only [hall, ite_true]
    rfl

/-- The documented refusals: fewer than two wanted fields. -/
theorem merged_refuses_few {r : Req} {s : ISet} {coll : Nat} {group : Bool}
    (h : wantedCount r < 2) : mergedIndexesFor r s coll group = none := by
  unfold mergedIndexesFor
  simp [h]

/-- The documented refusals: an explicit order on an equality field. -/
theorem merged_refuses_eq_ordered {r : Req} {s : ISet} {coll : Nat} {group : Bool}
    (h : r.eqOrdered = true) : mergedIndexesFor r s coll group = none := by
  unfold mergedIndexesFor
  simp [h]

/-- The algorithm refuses exactly in the documented cases and when some wanted field has no
member. -/
theorem merged_none_iff {r : Req} (hwf : WF r) (s : ISet) (coll : Nat) (group : Bool) :
    mergedIndexesFor r s coll group = none ↔
      (wantedCount r < 2 ∨ r.eqOrdered = true ∨
        ∃ x, Wanted r x ∧ ∀ m S, Member r s coll group m S → x ∉ S) := by
  have hiff := merged_iff_spec hwf s coll group
  rw [← Option.not_isSome_iff_eq_none, hiff]
  unfold MergeSpec
  constructor
  · intro h
    by_cases h2 : wantedCount r < 2
    · exact Or.inl h2
    · by_cases ho : r.eqOrdered = true
      · exact Or.inr (Or.inl ho)
      · refine Or.inr (Or.inr ?_)
        apply Classical.byContradiction
        intro hne
        apply h
        refine ⟨by omega, by simpa using ho, fun x hx => ?_⟩
        apply Classical.byContradiction
        intro hno
        exact hne ⟨x, hx, fun m S hm hxS => hno ⟨m, S, hm, hxS⟩⟩
  · rintro (h2 | ho | ⟨x, hx, hno⟩) ⟨h2', ho', hcov⟩
    · omega
    · simp [ho] at ho'
    · obtain ⟨m, S, hm, hxS⟩ := hcov x hx
      exact hno m S hm hxS

/-! ## Monotonicity and order independence -/

theorem member_mono {r : Req} {s s' : ISet} (hle : s.le s') {coll : Nat} {group : Bool}
    {m : Index} {S : List Field} (h : Member r s coll group m S) : Member r s' coll group m S := by
  cases h with
  | composite _ S hidx hne hS hserves => exact .composite _ S (hle.1 _ hidx) hne hS hserves
  | automatic f hf hall hm => exact .automatic f hf hall (hasMode_mono hle hm)
  | arrayContains c hc hall hdir hm => exact .arrayContains c hc hall hdir (hasMode_mono hle hm)

theorem merged_mono {r : Req} (hwf : WF r) {s s' : ISet} (hle : s.le s') (coll : Nat)
    (group : Bool) (h : (mergedIndexesFor r s coll group).isSome = true) :
    (mergedIndexesFor r s' coll group).isSome = true := by
  obtain ⟨h2, ho, hcov⟩ := (merged_iff_spec hwf s coll group).mp h
  apply (merged_iff_spec hwf s' coll group).mpr
  refine ⟨h2, ho, fun x hx => ?_⟩
  obtain ⟨m, S, hm, hxS⟩ := hcov x hx
  exact ⟨m, S, member_mono hle hm, hxS⟩

/-- If the first index set picks an enabled mode, the larger one picks an enabled mode too. -/
theorem autoMode_mono {r : Req} {s s' : ISet} (hle : s.le s') {coll : Nat} {group : Bool}
    {f : Field}
    (h : (match autoMode r s coll group f with
      | none => none
      | some m => if hasMode s coll f group m = true then some (singleFieldIndex coll group f m
          (modeFor (nameDirOf r.order))) else none).isSome = true) :
    ∃ m, autoMode r s' coll group f = some m ∧ hasMode s' coll f group m = true := by
  split at h
  · simp at h
  · rename_i m hm
    split at h
    · rename_i hen
      unfold autoMode at hm ⊢
      simp only at hm ⊢
      split
      · rename_i hc
        rw [ite_eq_left hc] at hm
        exact ⟨m, hm, hasMode_mono hle hen⟩
      · rename_i hc
        rw [ite_eq_right hc] at hm
        split
        · rename_i o ho
          rw [ho] at hm
          exact ⟨m, hm, hasMode_mono hle hen⟩
        · rename_i ho
          rw [ho] at hm
          obtain ⟨x, hx, hpx⟩ := List.find?_isSome.mp (Option.isSome_iff_exists.mpr ⟨m, hm⟩)
          have hs' : (List.find? (fun m => hasMode s' coll f group m)
              [modeFor (nameDirOf r.order), .asc, .desc]).isSome = true :=
            List.find?_isSome.mpr ⟨x, hx, hasMode_mono hle hpx⟩
          obtain ⟨m', hm'⟩ := Option.isSome_iff_exists.mp hs'
          exact ⟨m', hm', List.find?_some hm'⟩
    · simp at h

theorem automatic_mono {r : Req} {s s' : ISet} (hle : s.le s') (coll : Nat) (group : Bool)
    (h : (automaticIndexFor r s coll group).isSome = true) :
    (automaticIndexFor r s' coll group).isSome = true := by
  unfold automaticIndexFor at *
  simp only at *
  split at h
  · simp at h
  · rename_i hlen
    rw [ite_eq_right hlen]
    split at h
    · exact h
    · rename_i f rest ht
      split at h
      · simp at h
      · rename_i hex
        have hex' : isExempt s' coll f group = false := by
          cases hc : isExempt s' coll f group
          · rfl
          · exact absurd (isExempt_mono hle hc) hex
        rw [ite_eq_right (by simp [hex'])]
        obtain ⟨m', hm', hen'⟩ := autoMode_mono hle h
        rw [hm']
        simp [hen']

/-- When `decideReq` serves a requirement. -/
theorem served_iff (r : Req) (s : ISet) (coll : Nat) (group : Bool) (p : Policy) (e : Edition) :
    (decideReq r s coll group p e).served = true ↔
      ((automaticIndexFor r s coll group).isSome = true ∨
        (s.composites.find? fun i => compositeServes i r coll group).isSome = true ∨
        (p.productionRules = true ∧ (mergedIndexesFor r s coll group).isSome = true)) := by
  unfold decideReq
  cases ha : automaticIndexFor r s coll group with
  | some a => simp [Decision.served]
  | none =>
    cases hf : s.composites.find? (fun i => compositeServes i r coll group) with
    | some i => simp [Decision.served]
    | none =>
      cases hm : mergedIndexesFor r s coll group <;> cases p <;> cases e <;>
        simp [Decision.served, Policy.productionRules, Policy.assumes]

theorem find_mono {r : Req} {s s' : ISet} (hle : s.le s') (coll : Nat) (group : Bool)
    (h : (s.composites.find? fun i => compositeServes i r coll group).isSome = true) :
    (s'.composites.find? fun i => compositeServes i r coll group).isSome = true := by
  obtain ⟨i, hi, hp⟩ := List.find?_isSome.mp h
  exact List.find?_isSome.mpr ⟨i, hle.1 i hi, hp⟩

/-- Adding composites or enabling single-field modes never turns a served requirement into a
refused one. -/
theorem decide_mono {r : Req} (hwf : WF r) {s s' : ISet} (hle : s.le s') (coll : Nat)
    (group : Bool) (p : Policy) (e : Edition)
    (h : (decideReq r s coll group p e).served = true) :
    (decideReq r s' coll group p e).served = true := by
  rw [served_iff] at *
  rcases h with h | h | ⟨hp, h⟩
  · exact Or.inl (automatic_mono hle coll group h)
  · exact Or.inr (Or.inl (find_mono hle coll group h))
  · exact Or.inr (Or.inr ⟨hp, merged_mono hwf hle coll group h⟩)

theorem le_of_perm {s s' : ISet} (hp : s.composites.Perm s'.composites) (hm : s.modes = s'.modes) :
    s.le s' :=
  ⟨fun _ hi => hp.mem_iff.mp hi, fun _ _ _ hx => hm ▸ hx⟩

/-- Whether a merge exists does not depend on the order composites were added in. -/
theorem merged_perm {r : Req} (hwf : WF r) {s s' : ISet} (hp : s.composites.Perm s'.composites)
    (hm : s.modes = s'.modes) (coll : Nat) (group : Bool) :
    (mergedIndexesFor r s coll group).isSome = (mergedIndexesFor r s' coll group).isSome := by
  apply Bool.eq_iff_iff.mpr
  exact ⟨merged_mono hwf (le_of_perm hp hm) coll group,
    merged_mono hwf (le_of_perm hp.symm hm.symm) coll group⟩

/-- Whether a requirement is served does not depend on the order composites were added in. -/
theorem decide_served_perm {r : Req} (hwf : WF r) {s s' : ISet}
    (hp : s.composites.Perm s'.composites) (hm : s.modes = s'.modes) (coll : Nat) (group : Bool)
    (p : Policy) (e : Edition) :
    (decideReq r s coll group p e).served = (decideReq r s' coll group p e).served := by
  apply Bool.eq_iff_iff.mpr
  exact ⟨decide_mono hwf (le_of_perm hp hm) coll group p e,
    decide_mono hwf (le_of_perm hp.symm hm.symm) coll group p e⟩

/-! ## Requirements built from queries -/

theorem not_name_eqFields_aux (fs : List Filter) (acc : List Field) (h : NAME ∉ acc) :
    NAME ∉ fs.foldl (fun acc a =>
      match a with
      | .eq f => if f == NAME then acc else addUniq acc f
      | .isNull f => if f == NAME then acc else addUniq acc f
      | _ => acc) acc := by
  induction fs generalizing acc with
  | nil => exact h
  | cons a rest ih =>
    simp only [List.foldl_cons]
    apply ih
    cases a with
    | eq f | isNull f =>
      simp only
      split
      · exact h
      · rename_i hf
        unfold addUniq
        split
        · exact h
        · simp only [List.mem_append, List.mem_singleton, not_or]
          exact ⟨h, fun e => hf (by simp [e])⟩
    | contains f => exact h
    | gt f => exact h

theorem reqOf_wf (q : Query) : WF (reqOf q) where
  name_not_eq := not_name_eqFields_aux q.filters [] (by simp)
  order_not_eq := by
    intro o ho
    simp only [reqOf, List.mem_filter] at ho ⊢
    simpa [List.contains_iff_mem] using ho.2

end IM
