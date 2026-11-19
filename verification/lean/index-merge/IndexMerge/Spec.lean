import IndexMerge.Model

/-!
# The declarative specification of an index merge

`MergeSpec r s coll group` says when production's rules serve requirement `r` by merging
indexes, as a statement about the existence of members, without candidate lists, ordering or a
greedy choice: there are at least two wanted filters, no explicit order names an equality
field, and every wanted filter is covered by some member of the phase that applies
(`Covers r s coll group (!group)`). A wanted filter is an equality on a field, `(.eq, f)`, or
the array filter, `(.contains, c)`; a member covers equalities by ordered index fields and the
array filter by a contains index field, never one for the other (`tags == [z] AND tags
array-contains z` needs an ordered member for `tags`).

A member (`Member r s coll group recorded`) is one of:

- a configured composite that, on its own, serves the requirement made of some of the equality
  fields and the same order (`compositeServes`, the single-index rule), covering those
  equalities; in the recorded phase, with nothing but `__name__` ordered, ascending
  (`carryOk`), also of some equality fields followed by the array field, covering the array
  filter too (production merges `(a ASC, tags CONTAINS)` with `(b ASC)` for `a == x AND b == y
  AND tags array-contains z`);
- the automatic index `(f m, __name__ m)` of an equality field `f`, when nothing but `__name__`
  is ordered and that index is enabled for the query's scope, `m` being the requested
  `__name__` direction;
- the automatic contains index `(c CONTAINS, __name__ m)` of the array field, when nothing but
  `__name__` is ordered and the index is enabled, for an ascending `__name__`, and in the
  recorded phase also for a descending one when the array filter is a plain array-contains
  (production merges `(tags CONTAINS, __name__ DESC)` with `(a DESC, __name__ DESC)`).

The recorded phase (`recorded = true`) applies at collection scope only; its members include
those of the other phase (`member_recorded`), so at collection scope `Covers` of the recorded
phase is the condition, and at collection-group scope that of the other phase.

`BroadSpec` is the wider reading of the plan ("each member serves a subset of the wanted
filters followed by the same order suffix") with the planner's own single-index rules under
production's rules on Standard: a member is any index that `automaticIndexFor` or
`compositeServes` accepts for a sub-requirement of some distinct equality fields and,
optionally, the array field. `Counterexamples.lean` proves `MergeSpec → BroadSpec` and shows
that the converse fails.
-/

namespace IM

/-- What `reqOf` guarantees of a requirement: `__name__` is never an equality field, and no
order names an equality field (they are filtered out, `eqOrdered` records whether one was). -/
structure WF (r : Req) : Prop where
  name_not_eq : NAME ∉ r.eq
  order_not_eq : ∀ o ∈ r.order, o.path ∉ r.eq

/-- The filters a merge must cover. -/
def Wanted (r : Req) (x : Cov) : Prop := x ∈ wanted r

inductive Member (r : Req) (s : ISet) (coll : Nat) (group : Bool) (recorded : Bool) :
    Index → List Cov → Prop
  | composite (idx : Index) (S : List Field) (c : Option Field) :
      idx ∈ s.composites → S ≠ [] → (∀ x ∈ S, x ∈ r.eq) →
      (c = none ∨ (c = r.contains ∧ carryOk r recorded = true)) →
      compositeServes idx (subReqC r S c) coll group = true →
      Member r s coll group recorded idx (eqCov S ++ containsCov c)
  | automatic (f : Field) :
      f ∈ r.eq → (∀ o ∈ r.order, o.path = NAME) →
      hasMode s coll f group (modeFor (nameDirOf r.order)) = true →
      Member r s coll group recorded
        (singleFieldIndex coll group f (modeFor (nameDirOf r.order)) (modeFor (nameDirOf r.order)))
        [(.eq, f)]
  | arrayContains (c : Field) :
      r.contains = some c → (∀ o ∈ r.order, o.path = NAME) →
      hasMode s coll c group .contains = true →
      (nameDirOf r.order = .asc ∨ (recorded = true ∧ r.containsAny = false)) →
      Member r s coll group recorded
        (singleFieldIndex coll group c .contains (modeFor (nameDirOf r.order))) [(.contains, c)]

/-- Every wanted filter is covered by a member of the phase. -/
def Covers (r : Req) (s : ISet) (coll : Nat) (group : Bool) (recorded : Bool) : Prop :=
  ∀ x, Wanted r x → ∃ m S, Member r s coll group recorded m S ∧ x ∈ S

def MergeSpec (r : Req) (s : ISet) (coll : Nat) (group : Bool) : Prop :=
  2 ≤ wantedCount r ∧ r.eqOrdered = false ∧ Covers r s coll group (!group)

/-- The planner's single-index rules (production's rules, Standard) applied to a
sub-requirement; the automatic rule takes distinct equality fields, as every requirement built
from a query has. -/
def SingleServes (r : Req) (s : ISet) (coll : Nat) (group : Bool) (m : Index) (S : List Field)
    (c : Option Field) : Prop :=
  (S ≠ [] ∨ c.isSome) ∧ (∀ x ∈ S, x ∈ r.eq) ∧ (c = none ∨ c = r.contains) ∧
    ((S.Nodup ∧ automaticIndexFor (subReqC r S c) s coll group (!group) = some m) ∨
      (m ∈ s.composites ∧ compositeServes m (subReqC r S c) coll group = true))

def BroadSpec (r : Req) (s : ISet) (coll : Nat) (group : Bool) : Prop :=
  2 ≤ wantedCount r ∧ r.eqOrdered = false ∧
    ∀ x, Wanted r x → ∃ m S c, SingleServes r s coll group m S c ∧ x ∈ eqCov S ++ containsCov c

/-- One index set is contained in another: every composite of the first is in the second, and
every enabled single-field mode of the first is enabled in the second. -/
def ISet.le (s s' : ISet) : Prop :=
  (∀ i ∈ s.composites, i ∈ s'.composites) ∧ ∀ c f p, p ∈ s.modes c f → p ∈ s'.modes c f

end IM
