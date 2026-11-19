import IndexMerge.Theorems

/-!
# The broader reading of the specification, and what the algorithm does not do

`spec_implies_broad`: every merge the algorithm makes is also a merge under `BroadSpec`, where a
member is any index the planner's own single-index rules (under production's rules) accept for
some distinct equality fields and, optionally, the array field. The converse is false:

- `broad_mirror_direction_automatic`, `broad_not_complete`: the single-index rule serves
  `a == x ORDER BY __name__ ASC` with `a`'s descending automatic index (an equality prefix
  serves either direction), but a merge takes an automatic index only in the requested
  `__name__` direction. This shape has no recorded production verdict.

Three shapes that were counterexamples before the index-merge observation
(`conformance/fs-query-index-merge-production.json`, recorded 2026-11-19) now follow
production:

- `merge_composite_with_array_field` (F1): a composite that carries the array field after its
  equality prefix joins a merge as the member for those fields and the array field, when
  nothing but `__name__` is ordered, ascending (the recorded shape);
  `composite_with_array_field_descending_name_refused` (unrecorded): with `__name__`
  descending it does not.
- `opposite_direction_automatic_refused` (F2): production refuses `a == x ORDER BY __name__
  DESC` when only `a`'s ascending index is enabled, so the single-index rule does too, nothing
  serves `a` in `a == x AND b == y ORDER BY __name__ DESC`, and `BroadSpec` fails with the merge.
- `merge_contains_with_descending_name` (F3): the contains index of a plain array-contains
  joins a merge for a descending `__name__` too.

The recorded rules apply only where the merge was refused without them, and only at collection
scope. Their boundaries, none with a recorded verdict: `composite_with_array_field_group_refused`
and `contains_descending_name_group_refused` (collection-group scope),
`contains_any_descending_name_refused` (array-contains-any), and
`single_equality_neighbours_served` (the single-equality refusal on Enterprise and at
collection-group scope).

Coverage is by filter kind: `array_member_never_covers_equality` and
`carried_array_field_never_covers_equality` refuse `tags == [z] AND tags array-contains z`
unless an ordered member covers the equality on `tags`.

The other findings concern how the result depends on the configuration:

- `members_depend_on_order`: the members chosen depend on the order composites were added in
  (whether a merge exists does not: `merged_perm`).
- `one_member_merge`: a composite that repeats an equality field makes a "merge" of one member,
  and that member serves no duplicate-free set of the equality fields on its own;
  `repeated_single_equality_refused`: with one equality the same composite is refused.

Fields are numbers: 1 is `a`, 2 is `b`, 3 is `tags`, 4 is `e`; collection group 0.
-/

namespace IM

/-! ## Every merge is a merge under the single-index rules -/

theorem filter_name_nil {order : List OrderC} (h : ∀ o ∈ order, o.path = NAME) :
    order.filter (·.path != NAME) = [] := by
  rw [List.filter_eq_nil_iff]
  intro o ho
  simp [h o ho]

theorem find_path_none {order : List OrderC} (h : ∀ o ∈ order, o.path = NAME) {f : Field}
    (hf : f ≠ NAME) : order.find? (·.path == f) = none := by
  rw [List.find?_eq_none]
  intro o ho
  simp only [beq_iff_eq]
  rw [h o ho]
  exact fun e => hf e.symm

theorem eraseDups_single (f : Field) : [f].eraseDups = [f] := by
  simp [List.eraseDups, List.eraseDupsBy, List.eraseDupsBy.loop]

theorem auto_of_automatic_member {r : Req} {s : ISet} {coll : Nat} {group : Bool} {f : Field}
    (hf : f ≠ NAME) (hall : ∀ o ∈ r.order, o.path = NAME)
    (hm : hasMode s coll f group (modeFor (nameDirOf r.order)) = true) :
    automaticIndexFor (subReqC r [f] none) s coll group (!group) =
      some (singleFieldIndex coll group f (modeFor (nameDirOf r.order))
        (modeFor (nameDirOf r.order))) := by
  have ht : touched (subReqC r [f] none) = [f] := by
    simp [touched, subReqC, filter_name_nil hall, eraseDups_single]
  unfold automaticIndexFor
  simp only [ht, List.length_singleton, gt_iff_lt, Nat.lt_irrefl, ite_false]
  simp only [subReqC, not_exempt_of_hasMode hm, Bool.false_eq_true, ite_false]
  have hmode : autoMode (subReqC r [f] none) s coll group (!group) f =
      some (modeFor (nameDirOf r.order)) := by
    unfold autoMode
    cases hd : nameDirOf r.order <;> cases group <;>
      simp [subReqC, find_path_none hall hf, hd, modeFor] <;> simp [hd, modeFor] at hm <;>
      simp [hm]
  simp only [subReqC] at hmode
  rw [hmode]
  simp [hm]

theorem auto_of_contains_member {r : Req} {s : ISet} {coll : Nat} {group : Bool} {c : Field}
    (hc : c ≠ NAME) (hall : ∀ o ∈ r.order, o.path = NAME)
    (hm : hasMode s coll c group .contains = true) :
    automaticIndexFor (subReqC r [] (some c)) s coll group (!group) =
      some (singleFieldIndex coll group c .contains (modeFor (nameDirOf r.order))) := by
  have ht : touched (subReqC r [] (some c)) = [c] := by
    simp [touched, subReqC, filter_name_nil hall, eraseDups_single]
  unfold automaticIndexFor
  simp only [ht, List.length_singleton, gt_iff_lt, Nat.lt_irrefl, ite_false]
  simp only [subReqC, not_exempt_of_hasMode hm, Bool.false_eq_true, ite_false]
  have hmode : autoMode (subReqC r [] (some c)) s coll group (!group) c = some .contains := by
    unfold autoMode
    simp [subReqC, find_path_none hall hc]
  simp only [subReqC] at hmode
  rw [hmode]
  simp [hm]

theorem single_of_member {r : Req} (hwf : WF r) (hc : r.contains ≠ some NAME) {s : ISet}
    {coll : Nat} {group : Bool} {rec : Bool} {m : Index} {S : List Cov}
    (h : Member r s coll group rec m S) :
    ∃ S' c, SingleServes r s coll group m S' c ∧ ∀ x ∈ S, x ∈ eqCov S' ++ containsCov c := by
  cases h with
  | composite _ S c hidx hne hS hcc hserves =>
    exact ⟨S, c, ⟨Or.inl hne, hS, hcc.imp_right (·.1), Or.inr ⟨hidx, hserves⟩⟩,
      fun x hx => hx⟩
  | automatic f hf hall hm =>
    have hfn : f ≠ NAME := fun e => hwf.name_not_eq (e ▸ hf)
    refine ⟨[f], none, ⟨Or.inl (by simp), by simpa using hf, Or.inl rfl,
      Or.inl ⟨by simp, auto_of_automatic_member hfn hall hm⟩⟩, fun x hx => ?_⟩
    simp only [List.mem_singleton] at hx
    subst hx
    simp [eqCov, containsCov]
  | arrayContains c hcon hall hm _ =>
    have hcn : c ≠ NAME := fun e => hc (e ▸ hcon)
    refine ⟨[], some c, ⟨Or.inr rfl, by simp, Or.inr hcon.symm,
      Or.inl ⟨by simp, auto_of_contains_member hcn hall hm⟩⟩, fun x hx => ?_⟩
    simp only [List.mem_singleton] at hx
    subst hx
    simp [eqCov, containsCov]

theorem spec_implies_broad {r : Req} (hwf : WF r) (hc : r.contains ≠ some NAME) {s : ISet}
    {coll : Nat} {group : Bool} (h : MergeSpec r s coll group) : BroadSpec r s coll group := by
  obtain ⟨h2, ho, hcov⟩ := h
  refine ⟨h2, ho, fun x hx => ?_⟩
  obtain ⟨m, S, hm, hxS⟩ := hcov x hx
  obtain ⟨S', c, hs, hcover⟩ := single_of_member hwf hc hm
  exact ⟨m, S', c, hs, hcover x hxS⟩

/-! ## The recorded shapes and their boundaries -/

def stdModes : List (Scope × Mode) :=
  [(.collection, .asc), (.collection, .desc), (.collection, .contains)]

def nameAsc : List OrderC := [⟨NAME, .asc⟩]
def nameDesc : List OrderC := [⟨NAME, .desc⟩]

/-- `a == 1 AND b == 1 AND tags array-contains 1` with the composite `(a ASC, tags CONTAINS)`,
`a` and `tags` exempt. -/
def f1Req : Req := ⟨[1, 2], some 3, nameAsc, false, false⟩
def f1Composite : Index := ⟨0, .collection, [⟨1, .asc⟩, ⟨3, .contains⟩]⟩
def f1Set : ISet :=
  ⟨[f1Composite], fun _ f => if f == 1 || f == 3 then [] else stdModes⟩

/-- F1, recorded (`fs-query-index-merge/shapes/exempt-with-composite#f1-equalities-and-contains`
and its plan): the composite that carries the array field after `a` joins the merge as the
member for `a` and the array filter, with `b`'s automatic index; the members are what
production's plan names. -/
theorem merge_composite_with_array_field :
    BroadSpec f1Req f1Set 0 false ∧ MergeSpec f1Req f1Set 0 false ∧
      mergedIndexesFor f1Req f1Set 0 false =
        some [f1Composite, singleFieldIndex 0 false 2 .asc .asc] ∧
      decideReq f1Req f1Set 0 false .production .standard =
        .merge [f1Composite, singleFieldIndex 0 false 2 .asc .asc] := by
  have hm : (mergedIndexesFor f1Req f1Set 0 false).isSome = true := by decide
  have hspec := (merged_iff_spec ⟨by decide, by decide⟩ f1Set 0 false).mp hm
  exact ⟨spec_implies_broad ⟨by decide, by decide⟩ (by decide) hspec, hspec, by decide,
    by decide⟩

/-- F1 with `__name__` descending, unrecorded: the composite carries the array field only in
the recorded shape (nothing but `__name__` ordered, ascending), so with `ORDER BY __name__
DESC` it is no candidate, nothing else serves the exempt `a`, and the query is refused. No
production verdict exists for this shape. -/
theorem composite_with_array_field_descending_name_refused :
    let r : Req := { f1Req with order := nameDesc }
    mergedIndexesFor r f1Set 0 false = none ∧
      decideReq r f1Set 0 false .production .standard = .missing (requiredIndex r 0 false) := by
  constructor <;> decide

/-- F1 at collection-group scope, unrecorded: the same shape with a collection-group composite
`(a ASC, tags CONTAINS)`, `a` and `tags` exempt and `b` indexed at collection-group scope. The
recorded rules apply at collection scope only, so the composite does not carry the array field
and the query is refused. No production verdict exists for this shape. -/
def f1GroupComposite : Index := ⟨0, .group, [⟨1, .asc⟩, ⟨3, .contains⟩]⟩
def f1GroupSet : ISet :=
  ⟨[f1GroupComposite], fun _ f => if f == 1 || f == 3 then [] else [(.group, .asc)]⟩

theorem composite_with_array_field_group_refused :
    mergedIndexesFor f1Req f1GroupSet 0 true = none ∧
      decideReq f1Req f1GroupSet 0 true .production .standard =
        .missing (requiredIndex f1Req 0 true) := by
  constructor <;> decide

/-- `a == 1 AND b == 1 ORDER BY __name__ DESC` with only `a`'s ascending index enabled. -/
def f2Req : Req := ⟨[1, 2], none, nameDesc, false, false⟩
def f2Set : ISet := ⟨[], fun _ f => if f == 1 then [(.collection, .asc)] else stdModes⟩

theorem touched_subReqC_none {r : Req} (hall : ∀ o ∈ r.order, o.path = NAME) (S : List Field) :
    touched (subReqC r S none) = S.eraseDups := by
  simp [touched, subReqC, filter_name_nil hall]

/-- A list without duplicates whose elements are all `x` and that contains `x` is `[x]`. -/
theorem eq_singleton_of_nodup {S : List Field} {x : Field} (hn : S.Nodup) (hx : x ∈ S)
    (hall : ∀ y ∈ S, y = x) : S = [x] := by
  match S, hn, hx, hall with
  | [], _, hx, _ => simp at hx
  | [a], _, _, hall => rw [hall a (by simp)]
  | a :: b :: t, hn, _, hall =>
    exfalso
    have ha := hall a (by simp)
    have hb := hall b (by simp)
    have := (List.nodup_cons.mp hn).1
    exact this (by simp [ha, hb])

/-- F2, recorded (`fs-query-index-merge/shapes/ascending-only#f2-equalities-name-desc` and
`#a-alone-name-desc`): production refuses `a == 1 ORDER BY __name__ DESC` when only `a`'s
ascending index is enabled, and the single-index rule under production's rules does too, so
nothing serves `a` and F2 is no counterexample to completeness: `BroadSpec` fails, and the merge
refuses as production does. -/
theorem opposite_direction_automatic_refused :
    ¬ BroadSpec f2Req f2Set 0 false ∧ mergedIndexesFor f2Req f2Set 0 false = none ∧
      decideReq f2Req f2Set 0 false .production .standard =
        .missing (requiredIndex f2Req 0 false) := by
  refine ⟨?_, by decide, by decide⟩
  rintro ⟨_, _, hcov⟩
  obtain ⟨m, S, c, ⟨_, hS, hc, hserves⟩, hx⟩ :=
    hcov (.eq, 1) (by simp [Wanted, wanted, eqCov, containsCov, f2Req])
  have hc' : c = none := by rcases hc with hc | hc <;> simpa [f2Req] using hc
  subst hc'
  have h1 : 1 ∈ S := by simpa [eqCov, containsCov] using hx
  rcases hserves with ⟨hnd, hauto⟩ | ⟨hmem, _⟩
  · have hall : ∀ o ∈ f2Req.order, o.path = NAME := by decide
    have hauto0 := hauto
    unfold automaticIndexFor at hauto
    rw [touched_subReqC_none hall] at hauto
    simp only at hauto
    split at hauto
    · simp at hauto
    · rename_i hlen
      have hone : ∀ y ∈ S, y = 1 := by
        intro y hy
        have hy' : y ∈ S.eraseDups := List.mem_eraseDups.mpr hy
        have h1' : 1 ∈ S.eraseDups := List.mem_eraseDups.mpr h1
        match hE : S.eraseDups, hlen with
        | [], _ => rw [hE] at h1'; simp at h1'
        | [z], _ =>
          rw [hE] at hy' h1'
          simp at hy' h1'
          rw [hy', h1']
        | _ :: _ :: _, hlen => simp at hlen
      have hS1 := eq_singleton_of_nodup hnd h1 hone
      subst hS1
      have hnone : automaticIndexFor (subReqC f2Req [1] none) f2Set 0 false (!false) = none := by
        decide
      rw [hnone] at hauto0
      cases hauto0
  · simp [f2Set] at hmem

/-- `a == 1 AND tags array-contains 1 ORDER BY __name__ DESC` with the built-in single-field
indexes. -/
def f3Req : Req := ⟨[1], some 3, nameDesc, false, false⟩
def f3Set : ISet := ⟨[], fun _ _ => stdModes⟩

/-- F3, recorded (`fs-query-index-merge/shapes/builtin#f3-contains-name-desc` and its plan): the
contains index of a plain array-contains joins a merge for a descending `__name__` too, listed
first; the members are what production's plan names. -/
theorem merge_contains_with_descending_name :
    BroadSpec f3Req f3Set 0 false ∧ MergeSpec f3Req f3Set 0 false ∧
      mergedIndexesFor f3Req f3Set 0 false =
        some [singleFieldIndex 0 false 3 .contains .desc, singleFieldIndex 0 false 1 .desc .desc] ∧
      decideReq f3Req f3Set 0 false .production .standard =
        .merge [singleFieldIndex 0 false 3 .contains .desc,
          singleFieldIndex 0 false 1 .desc .desc] := by
  have hm : (mergedIndexesFor f3Req f3Set 0 false).isSome = true := by decide
  have hspec := (merged_iff_spec ⟨by decide, by decide⟩ f3Set 0 false).mp hm
  exact ⟨spec_implies_broad ⟨by decide, by decide⟩ (by decide) hspec, hspec, by decide,
    by decide⟩

/-- F3 at collection-group scope, unrecorded: with `a`'s descending and `tags`' contains index
enabled at collection-group scope, the recorded rules (collection scope only) do not apply and
the query is refused as before them. No production verdict exists for this shape. -/
def f3GroupSet : ISet :=
  ⟨[], fun _ f => if f == 1 then [(.group, .desc)] else if f == 3 then [(.group, .contains)]
    else []⟩

theorem contains_descending_name_group_refused :
    mergedIndexesFor f3Req f3GroupSet 0 true = none ∧
      decideReq f3Req f3GroupSet 0 true .production .standard =
        .missing (requiredIndex f3Req 0 true) := by
  constructor <;> decide

/-- F3 with `array-contains-any`, unrecorded: the descending contains member is taken for a
plain array-contains only, so `a == 1 AND tags array-contains-any [1] ORDER BY __name__ DESC`
is refused with the built-in indexes, as before the recorded rules. No production verdict
exists for this shape. -/
theorem contains_any_descending_name_refused :
    let r : Req := { f3Req with containsAny := true }
    mergedIndexesFor r f3Set 0 false = none ∧
      decideReq r f3Set 0 false .production .standard = .missing (requiredIndex r 0 false) := by
  constructor <;> decide

/-- `a == 1 AND tags == [1] AND tags array-contains 1` ordered by `__name__` in direction `d`,
with only `a`'s index in that direction and `tags`' contains index enabled, optionally `tags`'
index in that direction too. -/
def conflationReq (d : Dir) : Req := ⟨[1, 3], some 3, [⟨NAME, d⟩], false, false⟩
def conflationSet (d : Dir) (tagsOrdered : Bool) : ISet :=
  ⟨[], fun _ f => if f == 1 then [(.collection, modeFor d)]
    else if f == 3 then
      (if tagsOrdered then [(.collection, .contains), (.collection, modeFor d)]
        else [(.collection, .contains)])
    else stdModes⟩

/-- Coverage by filter kind (the stage-B review's defect, fixed): the contains member covers the
array filter only, never the equality `tags == [1]` on the same path, so without an ordered
index on `tags` the query is refused in either `__name__` direction, and with one it is
merged. -/
theorem array_member_never_covers_equality :
    ∀ d : Dir,
      decideReq (conflationReq d) (conflationSet d false) 0 false .production .standard =
          .missing (requiredIndex (conflationReq d) 0 false) ∧
        (decideReq (conflationReq d) (conflationSet d true) 0 false .production
          .standard).served = true := by
  intro d
  cases d <;> constructor <;> decide

/-- The composite carrying the array field covers `a` and the array filter, not `tags == [1]`:
`a == 1 AND b == 1 AND tags == [1] AND tags array-contains 1` with the F1 index set is
refused. -/
theorem carried_array_field_never_covers_equality :
    let r : Req := ⟨[1, 2, 3], some 3, nameAsc, false, false⟩
    decideReq r f1Set 0 false .production .standard = .missing (requiredIndex r 0 false) := by
  decide

/-- The single-equality refusal is production's on Standard at collection scope only. With only
`a`'s ascending index, `a == 1 ORDER BY __name__ DESC` is served from `(a ASC, __name__ DESC)`
on Enterprise and, with the collection-group ascending index, at collection-group scope. Both
neighbours are unrecorded. -/
theorem single_equality_neighbours_served :
    let r : Req := ⟨[1], none, nameDesc, false, false⟩
    decideReq r f2Set 0 false .production .enterprise =
        .use (singleFieldIndex 0 false 1 .asc .desc) ∧
      decideReq r ⟨[], fun _ f => if f == 1 then [(.group, .asc)] else stdModes⟩ 0 true
          .production .standard = .use (singleFieldIndex 0 true 1 .asc .desc) := by
  constructor <;> decide

/-- The mirror of F2, unrecorded: `a == 1 AND b == 1 ORDER BY __name__ ASC` with only `a`'s
descending index enabled. The single-index rule serves `a == 1 ORDER BY __name__ ASC` from
`(a DESC, __name__ ASC)` (an equality prefix serves either direction, and production's rules
change only the descending request), but a merge takes an automatic index only in the
requested `__name__` direction. No production verdict exists for this shape. -/
def mirrorReq : Req := ⟨[1, 2], none, nameAsc, false, false⟩
def mirrorSet : ISet := ⟨[], fun _ f => if f == 1 then [(.collection, .desc)] else stdModes⟩

theorem broad_mirror_direction_automatic :
    BroadSpec mirrorReq mirrorSet 0 false ∧ mergedIndexesFor mirrorReq mirrorSet 0 false = none ∧
      decideReq mirrorReq mirrorSet 0 false .production .standard =
        .missing (requiredIndex mirrorReq 0 false) := by
  refine ⟨⟨by decide, rfl, fun x hx => ?_⟩, by decide, by decide⟩
  simp only [Wanted, wanted, eqCov, containsCov, mirrorReq, List.map_cons, List.map_nil,
    Option.toList_none, List.append_nil, List.mem_cons, List.not_mem_nil, or_false] at hx
  rcases hx with (rfl | rfl)
  · exact ⟨singleFieldIndex 0 false 1 .desc .asc, [1], none,
      by unfold SingleServes subReqC; decide, by decide⟩
  · exact ⟨singleFieldIndex 0 false 2 .asc .asc, [2], none,
      by unfold SingleServes subReqC; decide, by decide⟩

/-- The completeness of the algorithm against `BroadSpec` fails, on the unrecorded mirror of
F2. -/
theorem broad_not_complete :
    ¬ ∀ (r : Req) (s : ISet) (coll : Nat) (group : Bool), WF r → r.contains ≠ some NAME →
      BroadSpec r s coll group → (mergedIndexesFor r s coll group).isSome = true := by
  intro h
  have := h mirrorReq mirrorSet 0 false ⟨by decide, by decide⟩ (by decide)
    broad_mirror_direction_automatic.1
  rw [broad_mirror_direction_automatic.2.1] at this
  exact absurd this (by decide)

/-! ## How the result depends on the configuration -/

/-- `a == 1 AND b == 1 ORDER BY e`: two composites serve `a` with the same order; the first one
added is the member. -/
def orderReq : Req := ⟨[1, 2], none, [⟨4, .asc⟩, ⟨NAME, .asc⟩], false, false⟩
def aE : Index := ⟨0, .collection, [⟨1, .asc⟩, ⟨4, .asc⟩]⟩
def aDescE : Index := ⟨0, .collection, [⟨1, .desc⟩, ⟨4, .asc⟩]⟩
def bE : Index := ⟨0, .collection, [⟨2, .asc⟩, ⟨4, .asc⟩]⟩

theorem members_depend_on_order :
    mergedIndexesFor orderReq ⟨[aE, aDescE, bE], fun _ _ => stdModes⟩ 0 false = some [aE, bE] ∧
      mergedIndexesFor orderReq ⟨[aDescE, aE, bE], fun _ _ => stdModes⟩ 0 false =
        some [aDescE, bE] := by
  constructor <;> decide

/-- `a == 1 AND b == 1` with every automatic index disabled and the composite `(a, a, b)`. -/
def repeated : Index := ⟨0, .collection, [⟨1, .asc⟩, ⟨1, .asc⟩, ⟨2, .asc⟩]⟩
def repeatedReq : Req := ⟨[1, 2], none, nameAsc, false, false⟩

theorem one_member_merge :
    decideReq repeatedReq ⟨[repeated], fun _ _ => []⟩ 0 false .production .standard =
        .merge [repeated] ∧
      ∀ S ∈ [[1], [2], [1, 2], [2, 1]],
        compositeServes repeated (subReq repeatedReq S) 0 false = false := by
  constructor <;> decide

/-- With one equality the repeated composite `(a, a)` is refused: one wanted field never merges,
although the composite would cover it. -/
theorem repeated_single_equality_refused :
    let r : Req := ⟨[1], none, nameAsc, false, false⟩
    let s : ISet := ⟨[⟨0, .collection, [⟨1, .asc⟩, ⟨1, .asc⟩]⟩], fun _ _ => []⟩
    decideReq r s 0 false .production .standard = .missing (requiredIndex r 0 false) ∧
      (greedy [] (candidates r s 0 false false)).1 = [(.eq, 1)] := by
  constructor <;> decide

end IM
