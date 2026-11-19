import IndexMerge.Model

/-!
# The head planner: the base decision with the recorded rules on top

`crates/fireemu-core-firestore/src/index.rs` decides a query as the base planner did
(`decideBase`, `IndexMerge/Model.lean`), then overrides that answer in three recorded shapes
(`conformance/fs-query-index-merge-production.json`, recorded 2026-11-19), and only under one
gate (`gate`): production's rules, Standard, collection scope, and a query whose filter is a
plain conjunction (`Query.conjunction`). Everywhere else the head answer is the base answer.

- (c) `a == x ORDER BY __name__ DESC` with only `a`'s ascending index enabled and no composite
  serving it: the base answer `(a ASC, __name__ DESC)` becomes unserved
  (ascending-only#a-alone-name-desc).
- (a) A plain array-contains with equalities, ordered by nothing but `__name__` descending: a
  refused base answer becomes the merge of the array field's contains index and the equality
  fields' descending indexes (builtin#f3-contains-name-desc).
- (b) The same ordered ascending: a refused base answer becomes the merge of one composite
  that carries the array field after its equality prefix and the ascending indexes of the
  remaining equality fields (exempt-with-composite#f1-equalities-and-contains).

Coverage in (a) and (b) is by filter kind; the gate's distinct paths make it coincide with the
base's coverage by path.
-/

namespace IM

/-! ## The gate -/

/-- The path a filter is on. -/
def Filter.path : Filter → Field
  | .eq f => f
  | .isNull f => f
  | .contains f => f
  | .containsAny f => f
  | .gt f => f

/-- A plain equality or a plain array-contains on a field other than `__name__`. -/
def Filter.plainAtom : Filter → Bool
  | .eq f => f != NAME
  | .contains f => f != NAME
  | _ => false

def Filter.isContains : Filter → Bool
  | .contains _ => true
  | _ => false

/-- The query as the client wrote it is a plain conjunction: every atom a plain equality or a
plain array-contains on a field other than `__name__`, the paths distinct, at most one
array-contains. `IS NULL`, ranges, `array-contains-any` and filters on `__name__` fail it. -/
def Query.conjunction (q : Query) : Bool :=
  q.filters.all Filter.plainAtom &&
    (q.filters.map Filter.path).eraseDups.length == q.filters.length &&
    (q.filters.filter Filter.isContains).length ≤ 1

/-- A plain conjunction of exactly one equality. -/
def Query.singleEquality (q : Query) : Bool :=
  q.conjunction &&
    match q.filters with
    | [.eq _] => true
    | _ => false

/-- When the recorded rules may apply. -/
def gate (q : Query) (p : Policy) (e : Edition) : Bool :=
  p.productionRules && e == .standard && !q.group && q.conjunction

/-! ## The recorded merge (a) and (b) -/

/-- The automatic index of each field, `(f m, __name__ m)`, when every field has it enabled. -/
def automaticMembers (s : ISet) (coll : Nat) (group : Bool) (m : Mode) (fs : List Field) :
    Option (List Index) :=
  if fs.all (fun f => !isExempt s coll f group && hasMode s coll f group m) then
    some (fs.map fun f => singleFieldIndex coll group f m m)
  else none

/-- The composites that carry the array field `t` right after a non-empty served equality
prefix and serve that prefix followed by `t` with the query's order, each with its cover (the
prefix's distinct fields and `t`), in `composites()` order. -/
def carryingComposites (r : Req) (s : ISet) (coll : Nat) (group : Bool) (t : Field) :
    List (List Field × Index) :=
  s.composites.filterMap fun idx =>
    let sp := servedPrefix r idx
    if !sp.isEmpty && idx.fields[sp.length]? == some ⟨t, .contains⟩ &&
        compositeServes idx ⟨sp, some t, r.order, false⟩ coll group then
      some (sp.eraseDups ++ [t], idx)
    else none

/-- The members of the recorded merge, when it applies. -/
def recordedMerge (r : Req) (s : ISet) (coll : Nat) (group : Bool) : Option (List Index) :=
  if wantedCount r < 2 || r.eqOrdered || !(r.order.all (·.path == NAME)) then none
  else
    match r.contains with
    | none => none
    | some t =>
      let eqs := sortFields r.eq
      if nameDirOf r.order == .desc then
        -- (a): the contains index first, then the equality fields' descending indexes.
        if !isExempt s coll t group && hasMode s coll t group .contains then
          (automaticMembers s coll group .desc eqs).map fun ms =>
            singleFieldIndex coll group t .contains .desc :: ms
        else none
      else
        -- (b): the largest carrying composite whose remaining equality fields all have their
        -- ascending index.
        (sortDesc (carryingComposites r s coll group t)).findSome? fun p =>
          let sp := servedPrefix r p.2
          (automaticMembers s coll group .asc (eqs.filter (fun f => !sp.contains f))).map
            fun ms => p.2 :: ms

/-! ## The single-equality refusal (c) -/

/-- The base's fallback for an unserved requirement. -/
def unservedDecision (r : Req) (coll : Nat) (group : Bool) (p : Policy) (e : Edition) :
    Decision :=
  let q := requiredIndex r coll group
  if p.assumes && e == .standard then .assumed q
  else
    match e with
    | .standard => .missing q
    | .enterprise => .fullScan q

/-- (c): the base served `i` by `a`'s automatic index with its ascending mode for one equality
ordered by nothing but `__name__` descending, and no composite serves the requirement. -/
def refusesSingleEquality (q : Query) (s : ISet) (i : Index) : Bool :=
  let r := reqOf q
  q.singleEquality && r.eq.length == 1 && r.contains.isNone && r.order.all (·.path == NAME) &&
    !r.eqOrdered && nameDirOf r.order == .desc &&
    automaticIndexFor r s q.coll q.group == some i &&
    (i.fields.head?.map (·.mode)) == some .asc &&
    (s.composites.find? (fun c => compositeServes c r q.coll q.group)).isNone

/-! ## The head decision -/

inductive Guard where
  | none
  | a
  | b
  | c
  deriving DecidableEq, Repr

/-- Which override fires for a query, if any. -/
def guardOf (q : Query) (s : ISet) (p : Policy) (e : Edition) : Guard :=
  if !gate q p e then .none
  else
    let r := reqOf q
    match decideBase q s p e with
    | .use i => if refusesSingleEquality q s i then .c else .none
    | .missing _ | .assumed _ =>
      match recordedMerge r s q.coll q.group with
      | some _ => if nameDirOf r.order == .desc then .a else .b
      | none => .none
    | _ => .none

/-- The head decision: the base answer, overridden where a recorded rule applies. -/
def decideHead (q : Query) (s : ISet) (p : Policy) (e : Edition) : Decision :=
  let base := decideBase q s p e
  if !gate q p e then base
  else
    let r := reqOf q
    match base with
    | .use i => if refusesSingleEquality q s i then unservedDecision r q.coll q.group p e else base
    | .missing _ | .assumed _ =>
      match recordedMerge r s q.coll q.group with
      | some ms => .merge ms
      | none => base
    | _ => base

end IM
