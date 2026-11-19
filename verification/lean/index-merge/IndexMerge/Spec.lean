import IndexMerge.Model

/-!
# The declarative specification of an index merge

`MergeSpec r s coll group` says when production's rules serve requirement `r` by merging
indexes, as a statement about the existence of members, without candidate lists, ordering or a
greedy choice: there are at least two wanted fields (the equality fields and the array field),
no explicit order names an equality field, and every wanted field is covered by some member.

A member (`Member`) is one of what production merges (recorded in
`conformance/fs-query-index-merge-production.json` and `conformance/fs-query-index-production.json`):

- a configured composite that, on its own, serves the requirement made of some of the equality
  fields and the same order (`compositeServes`, the single-index rule), or, when nothing but
  `__name__` is ordered, ascending (`carryOk`), of some of the equality fields followed by the
  array field (production merges `(a ASC, tags CONTAINS)` with `(b ASC)` for `a == x AND
  b == y AND tags array-contains z`; other orders have no recorded verdict and keep the
  equality-only member);
- the automatic index `(f m, __name__ m)` of an equality field `f`, when nothing but `__name__`
  is ordered and that index is enabled for the query's scope, `m` being the requested
  `__name__` direction;
- the automatic contains index `(c CONTAINS, __name__ m)` of the array field, when nothing but
  `__name__` is ordered and the index is enabled, `m` being the requested `__name__` direction
  (production merges `(tags CONTAINS, __name__ DESC)` with `(a DESC, __name__ DESC)`).

`BroadSpec` is the wider reading of the plan ("each member serves a subset of the wanted fields
followed by the same order suffix") with the planner's own single-index rules under
production's rules: a member is any index that `automaticIndexFor` (with `production_rules`)
or `compositeServes` accepts for a sub-requirement of some equality fields and, optionally, the
array field. `Counterexamples.lean` proves `MergeSpec → BroadSpec` and shows that the converse
fails.
-/

namespace IM

/-- What `reqOf` guarantees of a requirement: `__name__` is never an equality field, and no
order names an equality field (they are filtered out, `eqOrdered` records whether one was). -/
structure WF (r : Req) : Prop where
  name_not_eq : NAME ∉ r.eq
  order_not_eq : ∀ o ∈ r.order, o.path ∉ r.eq

/-- The fields a merge must cover. -/
def Wanted (r : Req) (x : Field) : Prop := x ∈ r.eq ∨ r.contains = some x

inductive Member (r : Req) (s : ISet) (coll : Nat) (group : Bool) : Index → List Field → Prop
  | composite (idx : Index) (S : List Field) (c : Option Field) :
      idx ∈ s.composites → S ≠ [] → (∀ x ∈ S, x ∈ r.eq) →
      (c = none ∨ (c = r.contains ∧ carryOk r = true)) →
      compositeServes idx (subReqC r S c) coll group = true →
      Member r s coll group idx (S ++ c.toList)
  | automatic (f : Field) :
      f ∈ r.eq → (∀ o ∈ r.order, o.path = NAME) →
      hasMode s coll f group (modeFor (nameDirOf r.order)) = true →
      Member r s coll group
        (singleFieldIndex coll group f (modeFor (nameDirOf r.order)) (modeFor (nameDirOf r.order)))
        [f]
  | arrayContains (c : Field) :
      r.contains = some c → (∀ o ∈ r.order, o.path = NAME) →
      hasMode s coll c group .contains = true →
      Member r s coll group
        (singleFieldIndex coll group c .contains (modeFor (nameDirOf r.order))) [c]

def MergeSpec (r : Req) (s : ISet) (coll : Nat) (group : Bool) : Prop :=
  2 ≤ wantedCount r ∧ r.eqOrdered = false ∧
    ∀ x, Wanted r x → ∃ m S, Member r s coll group m S ∧ x ∈ S

/-- The planner's single-index rules (under production's rules) applied to a sub-requirement. -/
def SingleServes (r : Req) (s : ISet) (coll : Nat) (group : Bool) (m : Index) (S : List Field)
    (c : Option Field) : Prop :=
  (S ≠ [] ∨ c.isSome) ∧ (∀ x ∈ S, x ∈ r.eq) ∧ (c = none ∨ c = r.contains) ∧
    (automaticIndexFor (subReqC r S c) s coll group true = some m ∨
      (m ∈ s.composites ∧ compositeServes m (subReqC r S c) coll group = true))

def BroadSpec (r : Req) (s : ISet) (coll : Nat) (group : Bool) : Prop :=
  2 ≤ wantedCount r ∧ r.eqOrdered = false ∧
    ∀ x, Wanted r x → ∃ m S c, SingleServes r s coll group m S c ∧ (x ∈ S ∨ c = some x)

/-- One index set is contained in another: every composite of the first is in the second, and
every enabled single-field mode of the first is enabled in the second. -/
def ISet.le (s s' : ISet) : Prop :=
  (∀ i ∈ s.composites, i ∈ s'.composites) ∧ ∀ c f p, p ∈ s.modes c f → p ∈ s'.modes c f

end IM
