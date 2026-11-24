import IndexMerge.Model

/-!
# The head planner: the base decision with the recorded rules on top

`crates/fireemu-core-firestore/src/index.rs` decides a query as the base planner did
(`decideBase`, `IndexMerge/Model.lean`), then overrides it under Standard's production rules.

- (c) Observation 2a refuses a mismatched automatic name direction for the recorded equality
  shapes, unless a composite serves. These include the original plain equality, orders on
  its equality field, one-element IN, two equalities on the same field joined by OR, IS NULL,
  and one count. Merge3 records the ascending-name mirror for a plain equality at collection scope as well.
- (a) A recorded descending-name array membership query uses the contains index and the automatic descending equality members, in that order.
- (b) An ascending-name query can join a carrier to the remaining ascending members. Observation 2b also records two carriers, a descending prefix and group carriers.
- Recorded automatic plans can be reordered or replaced, including the three-member shared path and the carrier preference in observation 2a.
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

/-- Provenance of the projected equality arm. IN and OR have equality arms, and COUNT
adds no required field. The source carries the distinction the baseline model does not need. -/
inductive QuerySource where
  | plain | inOne | orTwo | count | sharedArray
  deriving DecidableEq, Repr

def gate (p : Policy) (e : Edition) : Bool :=
  p.productionRules && e == .standard

/-- The unserved cases eligible for (a) or (b). The modeled contains-any atom has one
operand. Normalizing it here checks the distinct paths of its conjunction. -/
def mergeGate (q : Query) (source : QuerySource) : Bool :=
  let r := reqOf q
  let any := q.filters.any (fun f => match f with | .containsAny _ => true | _ => false)
  let normalized := { q with filters := q.filters.map fun (f : Filter) =>
    match f with | .containsAny p => .contains p | other => other }
  let nameOnly := q.orderBy.length ≤ 1 && q.orderBy.all (·.path == NAME)
  normalized.conjunction && r.contains.isSome && !r.eq.isEmpty && nameOnly &&
    if nameDirOf r.order == .desc then
      source == .plain && ((!(q.group || any)) || (r.eq.length == 1 && !(q.group && any)))
    else if q.group then source == .plain && !any && q.orderBy.isEmpty && r.eq.length == 2
    else if source == .count || any then
      (source == .plain || (source == .count && !any)) && q.orderBy.isEmpty && r.eq.length == 2
    else source == .plain && (q.orderBy.isEmpty || r.eq.length != 1)

/-! ## The recorded merge (a) and (b) -/

/-- The automatic index of each field, `(f m, __name__ m)`, when every field has it enabled. -/
def automaticMembers (s : ISet) (coll : Nat) (group : Bool) (m : Mode) (fs : List Field) :
    Option (List Index) :=
  if fs.all (fun f => !isExempt s coll f group && hasMode s coll f group m) then
    some (fs.map fun f => singleFieldIndex coll group f m m)
  else none

/-- A composite is related to this carrier shape if it uses the same collection, a
nonempty prefix of the query's equalities, and then the query's contains field. -/
def relatedCarrier (r : Req) (coll : Nat) (t : Field) (idx : Index) : Bool :=
  let sp := servedPrefix r idx
  idx.coll == coll && !sp.isEmpty && idx.fields[sp.length]? == some ⟨t, .contains⟩

def relatedCarriers (r : Req) (s : ISet) (coll : Nat) (t : Field) : List Index :=
  s.composites.filter (relatedCarrier r coll t)

/-- A qualifying carrier also has collection scope, an ascending equality prefix and
serves that prefix and the contains field with the query's order. -/
def carryingComposites (r : Req) (s : ISet) (coll : Nat) (group : Bool) (t : Field) :
    List Index :=
  s.composites.filter fun idx =>
    let sp := servedPrefix r idx
    idx.scope == .collection && (idx.fields.take sp.length).all (·.mode == .asc) &&
      relatedCarrier r coll t idx &&
      compositeServes idx ⟨sp, some t, r.order, false⟩ coll group

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
        -- (b): the unique carrier, then the remaining ascending automatic members.
        match carryingComposites r s coll group t with
        | [idx] =>
          let sp := servedPrefix r idx
          (automaticMembers s coll group .asc (eqs.filter (fun f => !sp.contains f))).map
            fun ms => idx :: ms
        | _ => none

/-- The modes `IndexSet::single_field_modes` returns without any override. -/
def builtinModes : List (Scope × Mode) :=
  [(.collection, .asc), (.collection, .desc), (.collection, .contains)]

/-- Sorting ignores catalog insertion order while retaining duplicate composites and their ordered fields. -/
structure ServingCatalog where
  composites : List Index
  modes : List (Field × List (Scope × Mode))
  deriving DecidableEq

def servingCatalog (indexes : List Index) (modes : List (Field × List (Scope × Mode))) : ServingCatalog :=
  let sort {α : Type} (le : α → α → Bool) (xs : List α) : List α := xs.foldr (fun x acc =>
    let (before, after) := acc.span (fun y => le y x)
    before ++ x :: after) []
  let byMode (a b : Scope × Mode) :=
    if a.1 == b.1 then compare a.2 b.2 != .gt else compare a.1 b.1 != .gt
  ⟨sort (fun a b => compare a b != .gt) indexes,
   sort (fun a b => a.1 ≤ b.1) (modes.map fun (f, ms) => (f, sort byMode ms))⟩

def relevantCatalog (q : Query) (s : ISet) : ServingCatalog :=
  let fields := (q.filters.map Filter.path ++ q.orderBy.map OrderC.path).eraseDups
  servingCatalog (s.composites.filter fun i => i.coll == q.coll)
    (fields.map fun f => (f, s.modes q.coll f))

/-- Each row pairs one complete catalog with its recorded plan, in query role order. -/
def servingRows (q : Query) (source : QuerySource) : List (ServingCatalog × List Index) :=
  match (reqOf q).contains, (reqOf q).eq with
  | some t, [e1] =>
    let member := singleFieldIndex q.coll false e1 .asc .desc
    if !q.group && q.orderBy == [⟨NAME, .desc⟩] && q.filters.contains (.contains t) then
      [(servingCatalog [member] [(e1, []), (t, builtinModes), (NAME, builtinModes)],
        [singleFieldIndex q.coll false t .contains .desc, member])]
    else []
  | some t, [e1, e2] =>
    if !q.orderBy.isEmpty || !q.filters.contains (.contains t) then [] else
    let carrier (scope : Scope) (f : Field) (m : Mode) : Index := ⟨q.coll, scope, [⟨f, m⟩, ⟨t, .contains⟩]⟩
    let asc := carrier .collection e1 .asc
    let second := carrier .collection e2 .asc
    let desc := carrier .collection e1 .desc
    let group := carrier .group e1 .asc
    let remainder := singleFieldIndex q.coll q.group e2 .asc .asc
    let fields := [(e1, []), (e2, builtinModes), (t, [])]
    let descPlan := [{ desc with fields := desc.fields ++ [⟨NAME, .asc⟩] }, remainder]
    (if q.group then [] else
      [(servingCatalog [asc, second] [(e1, []), (e2, []), (t, [])], [second, asc])]) ++
    (if source != .plain || q.group then [] else
      [(servingCatalog [asc, desc] fields, descPlan), (servingCatalog [desc] fields, descPlan)]) ++
    (if source != .plain then [] else
      [(servingCatalog [group] [(e1, []), (e2, [(.collection, .asc), (.group, .asc)]), (t, [])],
        [group, remainder])])
  | _, _ => []

/-- The group pair has no earlier collection-carrier fallback. -/
def earlierCompletion (q : Query) (s : ISet) : Option (List Index) :=
  let r := reqOf q
  if q.group && q.orderBy.isEmpty && r.eq.length == 2 &&
      r.contains.any (fun t => q.filters.contains (.contains t)) then none
  else recordedMerge r s q.coll q.group

def recordedCompletion (q : Query) (s : ISet) (source : QuerySource) : Option (List Index) :=
  let actual := relevantCatalog q s
  ((servingRows q source).find? (fun row => actual == row.1)).map Prod.snd |>.or (earlierCompletion q s)

/-! ## The single-equality refusal (c) -/

/-- The base's fallback for an unserved requirement. -/
def unservedDecision (r : Req) (coll : Nat) (group : Bool) (p : Policy) (e : Edition)
    (membershipFirst : Bool := false) : Decision :=
  let q := requiredIndex r coll group
  let q := if membershipFirst then
    let n := r.eq.length + 1
    { q with fields := (q.fields.take n).rotateRight ++ q.fields.drop n }
    else q
  if p.assumes && e == .standard then .assumed q
  else
    match e with
    | .standard => .missing q
    | .enterprise => .fullScan q

/-- On the recorded axes, an ordered automatic mode can serve an equality requirement
only when its mode agrees with the effective document-name direction. -/
def AutomaticEqualityServes (m : Mode) (d : Dir) : Prop := m = modeFor d

/-- The canonical order forms around the projected equality. A single explicit descending
equality order supplies the implicit descending name; an explicit name order may follow it. -/
def Query.equalityOrder (q : Query) : Bool :=
  match q.filters, q.orderBy with
  | [.eq f], [o] => o.path == f && o.dir == .desc
  | [.eq f], [o, n] => o.path == f && n.path == NAME
  | _, _ => false

def Query.equalityRefusal (q : Query) (source : QuerySource) : Bool :=
  let nameOnly := q.orderBy.all (·.path == NAME)
  if nameDirOf (reqOf q).order == .asc then
    source == .plain && nameOnly && q.singleEquality
  else
    match source with
    | .plain =>
      (q.singleEquality && (nameOnly || q.equalityOrder)) ||
        (nameOnly && match q.filters with | [.isNull f] => f != NAME | _ => false)
    | .inOne | .orTwo | .count => nameOnly && q.singleEquality
    | .sharedArray => false

/-- (c) changes a base automatic scan only on the recorded axes, if its ordered mode
disagrees with the effective document-name direction and no composite serves. -/
def refusesSingleEquality (q : Query) (s : ISet) (i : Index)
    (source : QuerySource := .plain) : Bool :=
  let r := reqOf q
  q.equalityRefusal source && r.eq.length == 1 && r.contains.isNone &&
    r.order.all (·.path == NAME) &&
    i.fields.head?.any (fun f => f.mode != modeFor (nameDirOf r.order)) &&
    automaticIndexFor r s q.coll q.group == some i &&
    (s.composites.find? (fun c => compositeServes c r q.coll q.group)).isNone

/-- Merge6 refuses the collection equality or unfiltered ordering when the exempt field has only the group-scoped ordered composite. -/
def refusesGroupOrdered (q : Query) (s : ISet) (i : Index) (source : QuerySource) : Bool :=
  !q.group && source == .plain && i.scope == .group &&
    (q.singleEquality && (q.orderBy.all (·.path == NAME) && nameDirOf (reqOf q).order == .desc) ||
      (q.filters.isEmpty && match q.orderBy with
        | [⟨f, .asc⟩, ⟨n, .desc⟩] => f != NAME && n == NAME
        | _ => false)) &&
    (match i.fields with
     | [⟨f, .asc⟩, ⟨n, .desc⟩] => n == NAME && isExempt s q.coll f false
     | _ => false) &&
    s.composites.all (fun c => !compositeServes c (reqOf q) q.coll false || c == i)

/-- The recorded refusals whose missing-index suggestion starts with the membership field. -/
def arrayFirst (q : Query) (s : ISet) (source : QuerySource) (base : Decision) : Bool :=
  let r := reqOf q
  match r.contains with
  | none => false
  | some t =>
    let ascName := q.orderBy == [⟨NAME, .asc⟩]
    let descName := q.orderBy == [⟨NAME, .desc⟩]
    let missing := match base with | .assumed _ | .missing _ => true | _ => false
    if source == .sharedArray then
      !q.group && ascName && (r.eq.length == 1 || r.eq.length == 2) &&
        q.filters.contains (.eq t) && q.filters.contains (.contains t) &&
        q.filters.all Filter.plainAtom && q.filters.length == r.eq.length + 1 &&
        ((s.modes q.coll t).filter (·.1 == .collection)).map Prod.snd == [.contains] &&
        (r.eq.all fun f => f == t ||
          match ((s.modes q.coll f).filter (·.1 == .collection)).map Prod.snd with
          | [.asc] | [.desc] => true
          | _ => false) &&
        !s.composites.any (fun i => i.coll == q.coll && i.fields.any (·.path == t))
    else if source != .plain || !q.conjunction || !q.filters.contains (.contains t) then false
    else match r.eq with
    | [f] =>
      !q.group && isExempt s q.coll f false &&
        ((descName && isExempt s q.coll t false &&
          (match base with | .use _ => true | _ => false) &&
          s.composites.all (fun i => !compositeServes i r q.coll false ||
            (i.scope == .collection && i.fields.length == 2))) ||
         (ascName && missing && hasMode s q.coll t false .contains &&
          s.composites.contains (singleFieldIndex q.coll false f .asc .desc)))
    | fs =>
      missing && descName && fs.length == (if q.group then 2 else 3) &&
        isExempt s q.coll t q.group && s.composites.any fun i =>
          let pre := i.fields.dropLast
          i.coll == q.coll && i.scope == scopeFor q.group && i.fields.getLast? == some ⟨t, .contains⟩ &&
            pre.length + 1 == fs.length &&
            pre.all (fun f => f.mode == .asc && fs.contains f.path && isExempt s q.coll f.path q.group) &&
            fs.any (fun f => !pre.any (·.path == f) && hasMode s q.coll f q.group .asc)

/-! ## The head decision -/

inductive Guard where
  | none
  | a
  | b
  | c
  | reverse
  | shared
  | carrier
  | groupOrdered
  | arrayFirst
  deriving DecidableEq, Repr

inductive PlanChange where
  | reverse (members : List Index)
  | shared (members : List Index)
  | carrier (members : List Index)

def PlanChange.guard : PlanChange → Guard
  | .reverse _ => .reverse
  | .shared _ => .shared
  | .carrier _ => .carrier

def PlanChange.members : PlanChange → List Index
  | .reverse ms | .shared ms | .carrier ms => ms

/-- The recorded ascending member orders and shared-array plans. Each requires the exact
baseline automatic members. A carrier wins over those members only for row 32's shape. -/
def recordedPlan (q : Query) (s : ISet) (source : QuerySource) (base : List Index) :
    Option PlanChange :=
  let r := reqOf q
  let nm := modeFor (nameDirOf r.order)
  let automatic := fun f m => singleFieldIndex q.coll false f m nm
  let eqs := sortFields r.eq
  let ordered := eqs.map (automatic · nm)
  let explicitName := q.orderBy.length == 1 && q.orderBy.all (·.path == NAME)
  let implicitCarrierShape := q.orderBy.isEmpty && eqs.length == 2 && r.contains.isSome
  let explicitReverseShape := explicitName && nm == .asc &&
    ((eqs.length == 1 && r.contains.isSome) || (eqs.length == 2 && r.contains.isNone))
  if q.group then none
  else if source == .sharedArray && explicitName && eqs.length == 2 &&
      q.filters.length == 3 && q.filters.all Filter.plainAtom && ordered == base then
    match r.contains with
    | some t =>
      if eqs.contains t && hasMode s q.coll t false .contains then
        let others := eqs.filter (· != t)
        some (.shared (automatic t .contains :: others.map (automatic · nm) ++ [automatic t nm]))
      else none
    | none => none
  else if source == .plain && q.conjunction && (implicitCarrierShape || explicitReverseShape) then
    let members := ordered ++ (r.contains.toList.map (automatic · .contains))
    if members != base then none
    else if implicitCarrierShape then
      match r.contains with
      | none => none
      | some t =>
        match relatedCarriers r s q.coll t with
        | [] => some (.reverse members.reverse)
        | [_] => (recordedMerge r s q.coll false).map PlanChange.carrier
        | _ => none
    else some (.reverse members.reverse)
  else none

/-- Which override fires for a query, if any. -/
def guardOf (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (source : QuerySource := .plain) : Guard :=
  if !gate p e then .none
  else
    let r := reqOf q
    let base := decideBase q s p e
    if arrayFirst q s source base then .arrayFirst else
    match base with
    | .use i => if refusesSingleEquality q s i source then .c
                else if refusesGroupOrdered q s i source then .groupOrdered else .none
    | .merge ms => ((recordedPlan q s source ms).map PlanChange.guard).getD .none
    | .missing _ | .assumed _ =>
      if mergeGate q source then
        match recordedCompletion q s source with
        | some _ => if nameDirOf r.order == .desc then .a else .b
        | none => .none
      else .none
    | _ => .none

/-- The head decision: the base answer, overridden where a recorded rule applies. -/
def decideHead (q : Query) (s : ISet) (p : Policy) (e : Edition)
    (source : QuerySource := .plain) : Decision :=
  let base := decideBase q s p e
  if !gate p e then base
  else
    let r := reqOf q
    if arrayFirst q s source base then unservedDecision r q.coll q.group p e true else
    match base with
    | .use i =>
      if refusesSingleEquality q s i source || refusesGroupOrdered q s i source then unservedDecision r q.coll q.group p e else base
    | .merge ms => ((recordedPlan q s source ms).map (Decision.merge ∘ PlanChange.members)).getD base
    | .missing _ | .assumed _ =>
      if mergeGate q source then
        match recordedCompletion q s source with
        | some ms => .merge ms
        | none => base
      else base
    | _ => base

end IM
