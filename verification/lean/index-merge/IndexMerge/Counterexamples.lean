import IndexMerge.HeadTheorems

/-!
# The broader reading of the specification, and what the algorithm does not do

`spec_implies_broad`: every merge the algorithm makes is also a merge under `BroadSpec`, where a
member is any index the planner's own single-index rules accept for some equality fields and,
optionally, the array field. The converse is false; the counterexamples below are findings,
and none of them has a recorded production verdict:

- `broad_composite_with_array_field`: a composite that carries the array field never joins a
  merge, although it serves its equality fields and the array field on its own.
- `broad_opposite_direction_automatic`: the single-index rule serves `a == x ORDER BY __name__
  DESC` with `a`'s ascending automatic index (an equality prefix serves either direction), but
  a merge takes an automatic index only in the requested `__name__` direction.
- `broad_contains_with_descending_name`: the single-index rule serves `tags array-contains x
  ORDER BY __name__ DESC` with the contains index, but a merge takes the contains index only for
  an ascending `__name__`.

The other two findings concern how the result depends on the configuration:

- `members_depend_on_order`: the members chosen depend on the order composites were added in
  (whether a merge exists does not: `merged_perm`).
- `one_member_merge`: a composite that repeats an equality field makes a "merge" of one member,
  and that member serves no duplicate-free set of the equality fields on its own;
  `repeated_single_equality_refused`: with one equality the same composite is refused.

These are facts about the base decision. The last section states the head decision
(`IndexMerge/Head.lean`) on the recorded shapes F1 (`head_f1`), F3 (`head_f3`), F2
(`head_f2_refused`) and the single-equality refusal (`head_single_equality_refused`), and on
their unrecorded neighbours, among them `first_attempt_conflation`: the base's coverage by path,
kept by the head.

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
    automaticIndexFor (subReqC r [f] none) s coll group =
      some (singleFieldIndex coll group f (modeFor (nameDirOf r.order))
        (modeFor (nameDirOf r.order))) := by
  have ht : touched (subReqC r [f] none) = [f] := by
    simp [touched, subReqC, filter_name_nil hall, eraseDups_single]
  unfold automaticIndexFor
  simp only [ht, List.length_singleton, gt_iff_lt, Nat.lt_irrefl, ite_false]
  simp only [subReqC, not_exempt_of_hasMode hm, Bool.false_eq_true, ite_false]
  have hmode : autoMode (subReqC r [f] none) s coll group f = some (modeFor (nameDirOf r.order)) := by
    unfold autoMode
    simp [subReqC, find_path_none hall hf, hm]
  simp only [subReqC] at hmode
  rw [hmode]
  simp [hm]

theorem auto_of_contains_member {r : Req} {s : ISet} {coll : Nat} {group : Bool} {c : Field}
    (hc : c ≠ NAME) (hall : ∀ o ∈ r.order, o.path = NAME) (hdir : nameDirOf r.order = .asc)
    (hm : hasMode s coll c group .contains = true) :
    automaticIndexFor (subReqC r [] (some c)) s coll group =
      some (singleFieldIndex coll group c .contains .asc) := by
  have ht : touched (subReqC r [] (some c)) = [c] := by
    simp [touched, subReqC, filter_name_nil hall, eraseDups_single]
  unfold automaticIndexFor
  simp only [ht, List.length_singleton, gt_iff_lt, Nat.lt_irrefl, ite_false]
  simp only [subReqC, not_exempt_of_hasMode hm, Bool.false_eq_true, ite_false]
  have hmode : autoMode (subReqC r [] (some c)) s coll group c = some .contains := by
    unfold autoMode
    simp [subReqC, find_path_none hall hc]
  simp only [subReqC] at hmode
  rw [hmode]
  simp [hm, hdir, modeFor]

theorem single_of_member {r : Req} (hwf : WF r) (hc : r.contains ≠ some NAME) {s : ISet}
    {coll : Nat} {group : Bool} {m : Index} {S : List Field} (h : Member r s coll group m S) :
    ∃ S' c, SingleServes r s coll group m S' c ∧ ∀ x ∈ S, x ∈ S' ∨ c = some x := by
  cases h with
  | composite _ S hidx hne hS hserves =>
    exact ⟨S, none, ⟨Or.inl hne, hS, Or.inl rfl, Or.inr ⟨hidx, hserves⟩⟩, fun x hx => Or.inl hx⟩
  | automatic f hf hall hm =>
    have hfn : f ≠ NAME := fun e => hwf.name_not_eq (e ▸ hf)
    refine ⟨[f], none, ⟨Or.inl (by simp), by simpa using hf, Or.inl rfl,
      Or.inl (auto_of_automatic_member hfn hall hm)⟩, fun x hx => Or.inl hx⟩
  | arrayContains c hcon hall hdir hm =>
    have hcn : c ≠ NAME := fun e => hc (e ▸ hcon)
    refine ⟨[], some c, ⟨Or.inr rfl, by simp, Or.inr hcon.symm,
      Or.inl (auto_of_contains_member hcn hall hdir hm)⟩, fun x hx => ?_⟩
    simp at hx
    exact Or.inr (by rw [hx])

theorem spec_implies_broad {r : Req} (hwf : WF r) (hc : r.contains ≠ some NAME) {s : ISet}
    {coll : Nat} {group : Bool} (h : MergeSpec r s coll group) : BroadSpec r s coll group := by
  obtain ⟨h2, ho, hcov⟩ := h
  refine ⟨h2, ho, fun x hx => ?_⟩
  obtain ⟨m, S, hm, hxS⟩ := hcov x hx
  obtain ⟨S', c, hs, hcover⟩ := single_of_member hwf hc hm
  exact ⟨m, S', c, hs, hcover x hxS⟩

/-! ## Counterexamples -/

def stdModes : List (Scope × Mode) :=
  [(.collection, .asc), (.collection, .desc), (.collection, .contains)]

def nameAsc : List OrderC := [⟨NAME, .asc⟩]
def nameDesc : List OrderC := [⟨NAME, .desc⟩]

/-- `a == 1 AND b == 1 AND tags array-contains 1` with the composite `(a ASC, tags CONTAINS)`,
`a` and `tags` exempt. -/
def f1Req : Req := ⟨[1, 2], some 3, nameAsc, false⟩
def f1Composite : Index := ⟨0, .collection, [⟨1, .asc⟩, ⟨3, .contains⟩]⟩
def f1Set : ISet :=
  ⟨[f1Composite], fun _ f => if f == 1 || f == 3 then [] else stdModes⟩

theorem broad_composite_with_array_field :
    BroadSpec f1Req f1Set 0 false ∧ mergedIndexesFor f1Req f1Set 0 false = none ∧
      decideReq f1Req f1Set 0 false .production .standard =
        .missing (requiredIndex f1Req 0 false) := by
  refine ⟨⟨by decide, rfl, fun x hx => ?_⟩, by decide, by decide⟩
  simp only [Wanted, f1Req, List.mem_cons, List.not_mem_nil, or_false,
    Option.some.injEq] at hx
  rcases hx with (rfl | rfl) | rfl
  · exact ⟨f1Composite, [1], some 3, by unfold SingleServes subReqC; decide, Or.inl (by simp)⟩
  · exact ⟨singleFieldIndex 0 false 2 .asc .asc, [2], none,
      by unfold SingleServes subReqC; decide, Or.inl (by simp)⟩
  · exact ⟨f1Composite, [1], some 3, by unfold SingleServes subReqC; decide, Or.inr rfl⟩

/-- `a == 1 AND b == 1 ORDER BY __name__ DESC` with only `a`'s ascending index enabled. -/
def f2Req : Req := ⟨[1, 2], none, nameDesc, false⟩
def f2Set : ISet := ⟨[], fun _ f => if f == 1 then [(.collection, .asc)] else stdModes⟩

theorem broad_opposite_direction_automatic :
    BroadSpec f2Req f2Set 0 false ∧ mergedIndexesFor f2Req f2Set 0 false = none ∧
      decideReq f2Req f2Set 0 false .production .standard =
        .missing (requiredIndex f2Req 0 false) := by
  refine ⟨⟨by decide, rfl, fun x hx => ?_⟩, by decide, by decide⟩
  simp only [Wanted, f2Req, List.mem_cons, List.not_mem_nil, or_false,
    reduceCtorEq] at hx
  rcases hx with (rfl | rfl)
  · exact ⟨singleFieldIndex 0 false 1 .asc .desc, [1], none,
      by unfold SingleServes subReqC; decide, Or.inl (by simp)⟩
  · exact ⟨singleFieldIndex 0 false 2 .desc .desc, [2], none,
      by unfold SingleServes subReqC; decide, Or.inl (by simp)⟩

/-- `a == 1 AND tags array-contains 1 ORDER BY __name__ DESC` with the built-in single-field
indexes. -/
def f3Req : Req := ⟨[1], some 3, nameDesc, false⟩
def f3Set : ISet := ⟨[], fun _ _ => stdModes⟩

theorem broad_contains_with_descending_name :
    BroadSpec f3Req f3Set 0 false ∧ mergedIndexesFor f3Req f3Set 0 false = none ∧
      decideReq f3Req f3Set 0 false .production .standard =
        .missing (requiredIndex f3Req 0 false) := by
  refine ⟨⟨by decide, rfl, fun x hx => ?_⟩, by decide, by decide⟩
  simp only [Wanted, f3Req, List.mem_cons, List.not_mem_nil, or_false,
    Option.some.injEq] at hx
  rcases hx with rfl | rfl
  · exact ⟨singleFieldIndex 0 false 1 .desc .desc, [1], none,
      by unfold SingleServes subReqC; decide, Or.inl (by simp)⟩
  · exact ⟨singleFieldIndex 0 false 3 .contains .desc, [], some 3,
      by unfold SingleServes subReqC; decide, Or.inr rfl⟩

/-- The completeness of the algorithm against `BroadSpec` fails. -/
theorem broad_not_complete :
    ¬ ∀ (r : Req) (s : ISet) (coll : Nat) (group : Bool), WF r → r.contains ≠ some NAME →
      BroadSpec r s coll group → (mergedIndexesFor r s coll group).isSome = true := by
  intro h
  have := h f3Req f3Set 0 false ⟨by decide, by decide⟩ (by decide)
    broad_contains_with_descending_name.1
  rw [broad_contains_with_descending_name.2.1] at this
  exact absurd this (by decide)

/-- `a == 1 AND b == 1 ORDER BY e`: two composites serve `a` with the same order; the first one
added is the member. -/
def orderReq : Req := ⟨[1, 2], none, [⟨4, .asc⟩, ⟨NAME, .asc⟩], false⟩
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
def repeatedReq : Req := ⟨[1, 2], none, nameAsc, false⟩

theorem one_member_merge :
    decideReq repeatedReq ⟨[repeated], fun _ _ => []⟩ 0 false .production .standard =
        .merge [repeated] ∧
      ∀ S ∈ [[1], [2], [1, 2], [2, 1]],
        compositeServes repeated (subReq repeatedReq S) 0 false = false := by
  constructor <;> decide

/-- With one equality the repeated composite `(a, a)` is refused: one wanted field never merges,
although the composite would cover it. -/
theorem repeated_single_equality_refused :
    let r : Req := ⟨[1], none, nameAsc, false⟩
    let s : ISet := ⟨[⟨0, .collection, [⟨1, .asc⟩, ⟨1, .asc⟩]⟩], fun _ _ => []⟩
    decideReq r s 0 false .production .standard = .missing (requiredIndex r 0 false) ∧
      (greedy [] (candidates r s 0 false)).1 = [1] := by
  constructor <;> decide

/-! ## The head decision on the recorded shapes and their neighbours

Queries on collection group 0, fields as above. Each theorem states the base answer, the head
answer and the guard that fires. -/

def qF1 : Query := ⟨0, false, [.eq 1, .eq 2, .contains 3], []⟩
def qF3 : Query := ⟨0, false, [.eq 1, .contains 3], nameDesc⟩
def qF2 : Query := ⟨0, false, [.eq 1, .eq 2], nameDesc⟩
def qOneDesc : Query := ⟨0, false, [.eq 1], nameDesc⟩

/-- F1, recorded (exempt-with-composite#f1-equalities-and-contains and its plan): the base
refuses, (b) merges the carrying composite with `b`'s ascending index. -/
theorem head_f1 :
    decideBase qF1 f1Set .production .standard = .missing (requiredIndex (reqOf qF1) 0 false) ∧
      decideHead qF1 f1Set .production .standard =
        .merge [f1Composite, singleFieldIndex 0 false 2 .asc .asc] ∧
      guardOf qF1 f1Set .production .standard = .b := by
  refine ⟨by decide, by decide, by decide⟩

/-- F3, recorded (builtin#f3-contains-name-desc and its plan): the base refuses, (a) merges the
contains index with `a`'s descending index, the contains index first. -/
theorem head_f3 :
    decideBase qF3 f3Set .production .standard = .missing (requiredIndex (reqOf qF3) 0 false) ∧
      decideHead qF3 f3Set .production .standard =
        .merge [singleFieldIndex 0 false 3 .contains .desc, singleFieldIndex 0 false 1 .desc .desc] ∧
      guardOf qF3 f3Set .production .standard = .a := by
  refine ⟨by decide, by decide, by decide⟩

/-- F2, recorded (ascending-only#f2-equalities-name-desc): refused by base and head. -/
theorem head_f2_refused :
    decideHead qF2 f2Set .production .standard = .missing (requiredIndex (reqOf qF2) 0 false) ∧
      guardOf qF2 f2Set .production .standard = .none := by
  constructor <;> decide

/-- (c), recorded (ascending-only#a-alone-name-desc): the base serves `a == 1 ORDER BY __name__
DESC` from `(a ASC, __name__ DESC)`; the head refuses it. -/
theorem head_single_equality_refused :
    decideBase qOneDesc f2Set .production .standard =
        .use (singleFieldIndex 0 false 1 .asc .desc) ∧
      decideHead qOneDesc f2Set .production .standard =
        .missing (requiredIndex (reqOf qOneDesc) 0 false) ∧
      guardOf qOneDesc f2Set .production .standard = .c := by
  refine ⟨by decide, by decide, by decide⟩

/-- The neighbours of (c), unrecorded, keep the base answer `(a ASC, __name__ DESC)`: a
composite `(a DESC, __name__ DESC)` that serves the query, an order naming the equality field
(`ORDER BY a DESC`), Enterprise, and collection-group scope with the group-scoped ascending
index. -/
theorem head_single_equality_neighbours_served :
    decideHead qOneDesc ⟨[⟨0, .collection, [⟨1, .desc⟩, ⟨NAME, .desc⟩]⟩], f2Set.modes⟩
        .production .standard = .use (singleFieldIndex 0 false 1 .asc .desc) ∧
      decideHead ⟨0, false, [.eq 1], [⟨1, .desc⟩]⟩ f2Set .production .standard =
        .use (singleFieldIndex 0 false 1 .asc .desc) ∧
      decideHead qOneDesc f2Set .production .enterprise =
        .use (singleFieldIndex 0 false 1 .asc .desc) ∧
      decideHead { qOneDesc with group := true }
          ⟨[], fun _ f => if f == 1 then [(.group, .asc)] else stdModes⟩ .production .standard =
        .use (singleFieldIndex 0 true 1 .asc .desc) := by
  refine ⟨by decide, by decide, by decide, by decide⟩

/-- F1 ordered by `__name__` descending, unrecorded: (a) needs `tags`' contains index, which is
exempt, and (b) applies to an ascending `__name__` only, so the head refuses as the base does. -/
theorem head_f1_descending_refused :
    let q : Query := { qF1 with orderBy := nameDesc }
    decideHead q f1Set .production .standard = .missing (requiredIndex (reqOf q) 0 false) := by
  decide

/-- F1 and F3 at collection-group scope, unrecorded: outside the gate the head is the base,
which refuses both. -/
def f1GroupSet : ISet :=
  ⟨[⟨0, .group, [⟨1, .asc⟩, ⟨3, .contains⟩]⟩],
    fun _ f => if f == 1 || f == 3 then [] else [(.group, .asc)]⟩
def f3GroupSet : ISet :=
  ⟨[], fun _ f => if f == 1 then [(.group, .desc)] else if f == 3 then [(.group, .contains)]
    else []⟩

theorem head_group_refused :
    let q1 : Query := { qF1 with group := true }
    let q3 : Query := { qF3 with group := true }
    decideHead q1 f1GroupSet .production .standard = .missing (requiredIndex (reqOf q1) 0 true) ∧
      decideHead q3 f3GroupSet .production .standard =
        .missing (requiredIndex (reqOf q3) 0 true) := by
  constructor <;> decide

/-- F3 with `array-contains-any`, unrecorded: the filter fails the gate's shape, and the base
refuses. -/
theorem head_contains_any_refused :
    let q : Query := ⟨0, false, [.eq 1, .containsAny 3], nameDesc⟩
    decideHead q f3Set .production .standard = .missing (requiredIndex (reqOf q) 0 false) ∧
      guardOf q f3Set .production .standard = .none := by
  constructor <;> decide

/-- F1 and F3 on Enterprise, unrecorded: the head is the base, a full scan. -/
theorem head_enterprise_base :
    decideHead qF1 f1Set .production .enterprise = .fullScan (requiredIndex (reqOf qF1) 0 false) ∧
      decideHead qF3 f3Set .production .enterprise =
        .fullScan (requiredIndex (reqOf qF3) 0 false) := by
  constructor <;> decide

/-- `a == 1 AND tags == [1] AND tags array-contains 1` with only `a`'s ascending and `tags`'
contains index: the shared path fails the gate's shape, so the head is the base, whose merge
covers by path. Ascending, the base merges `a`'s index with `tags`' contains index, which also
counts as covering `tags == [1]` (the shared-path conflation, kept on purpose, unrecorded);
descending, the contains index is no member and the query is refused. -/
def conflationSet : ISet :=
  ⟨[], fun _ f => if f == 1 then [(.collection, .asc), (.collection, .desc)]
    else if f == 3 then [(.collection, .contains)] else stdModes⟩

theorem first_attempt_conflation :
    let q : Query := ⟨0, false, [.eq 1, .eq 3, .contains 3], nameAsc⟩
    let qd : Query := { q with orderBy := nameDesc }
    decideBase q conflationSet .production .standard =
        .merge [singleFieldIndex 0 false 1 .asc .asc, singleFieldIndex 0 false 3 .contains .asc] ∧
      decideHead q conflationSet .production .standard =
        .merge [singleFieldIndex 0 false 1 .asc .asc, singleFieldIndex 0 false 3 .contains .asc] ∧
      decideHead qd conflationSet .production .standard =
        .missing (requiredIndex (reqOf qd) 0 false) := by
  refine ⟨by decide, by decide, by decide⟩

/-- The F1 composite carries the array filter, not `tags == [1]`: with the equality on `tags`
the shape fails, and the base refuses. -/
theorem carried_array_field_with_equality_refused :
    let q : Query := ⟨0, false, [.eq 1, .eq 2, .eq 3, .contains 3], []⟩
    decideHead q f1Set .production .standard = .missing (requiredIndex (reqOf q) 0 false) := by
  decide

end IM
