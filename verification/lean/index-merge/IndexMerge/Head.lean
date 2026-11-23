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

/-- The recorded two-equality carrier has one ordered field followed by membership and an implicit or explicit ascending name. -/
def pairCarrier (s : ISet) (coll : Nat) (scope : Scope) (f t : Field) (m : Mode) : Option Index :=
  let fields : List IField := [⟨f, m⟩, ⟨t, .contains⟩]
  let bare : Index := ⟨coll, scope, fields⟩
  let named : Index := ⟨coll, scope, fields ++ [⟨NAME, .asc⟩]⟩
  (s.composites.find? fun i => i == bare || i == named).map fun i =>
    if m == .desc then named else i

/-- Complete the implicit pair in the Rust planner's priority order. A count admits the two collection carriers and otherwise falls through to the original carrier rule. -/
def pairMerge (q : Query) (s : ISet) (source : QuerySource) (left right t : Field) :
    Option (List Index) :=
  let carrier := pairCarrier s q.coll
  let two := if q.group then none else do
    let first ← carrier .collection right t .asc
    let second ← carrier .collection left t .asc
    return [first, second]
  two.or <| if source != .plain then none else
    [(Scope.collection, Mode.asc), (.collection, .desc), (.group, .asc)].findSome? fun (scope, mode) =>
      if q.group && scope != .group then none else
      [(right, left), (left, right)].findSome? fun (field, other) =>
        if !hasMode s q.coll other q.group .asc then none else
        (carrier scope field t mode).map fun idx =>
          let idx := if scope == .collection && mode == .asc then
            (carrier scope field t .desc).getD idx else idx
          [idx, singleFieldIndex q.coll q.group other .asc .asc]

/-- The new completions apply only to plain membership. The caller checks the canonical conjunction, name order, scope and source with `mergeGate`. -/
def recordedCompletion (q : Query) (s : ISet) (source : QuerySource) : Option (List Index) :=
  let r := reqOf q
  let original := recordedMerge r s q.coll q.group
  match r.contains, r.eq with
  | some t, [f] =>
    let member := singleFieldIndex q.coll false f .asc .desc
    if !q.group && q.orderBy == [⟨NAME, .desc⟩] && q.filters.contains (.contains t) &&
        !hasMode s q.coll f false .desc && hasMode s q.coll t false .contains &&
        s.composites.contains member then
      some [singleFieldIndex q.coll false t .contains .desc, member]
    else original
  | some t, [left, right] =>
    if q.orderBy.isEmpty && q.filters.contains (.contains t) then
      (pairMerge q s source left right t).or (if q.group then none else original)
    else original
  | _, _ => original

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
