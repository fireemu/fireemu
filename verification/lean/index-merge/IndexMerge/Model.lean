/-!
# The index planner as `crates/fireemu-core-firestore/src/index.rs` computes it

A transcription of the functions the index-merge decision depends on, one Lean definition per
Rust function, in the same order of checks:

- `compositeServes` is `composite_fields_serve` (through `composite_serves`);
- `automaticIndexFor` is `automatic_index_for`;
- `compositeCandidates`, `sortDesc`, `autoCandidates`, `greedy` and `mergeMembers` are
  `merge_members` (candidate collection, largest-cover-first ordering, greedy cover over
  filters by kind, `Kind`), with `recorded` selecting the rules production was recorded adding;
  `mergedIndexesFor` is `merged_indexes_for` (the attempt without them, then, at collection scope
  only, the attempt with them);
- `requiredIndex`, `decideReq` are `required_index` and `decide_disjunct` with
  `missing_decision` for one disjunct;
- `reqOf` is `requirement_for` over `Query::effective_order_by` for one conjunction.

Field paths are natural numbers: `NAME` (0) is `__name__`, and the corpus generator gives the
other numbers names whose `FieldPath` order is the numeric order. Collection groups are numbers
too. The single-field configuration is the effective result of `IndexSet::single_field_modes`
per collection group and field; how overrides are inherited along map paths is not modelled.
-/

namespace IM

abbrev Field := Nat

/-- `__name__`. -/
def NAME : Field := 0

inductive Mode where
  | asc
  | desc
  | contains
  | vector (dim : Nat)
  deriving DecidableEq, Repr

/-- `IndexFieldMode::is_ordered`. -/
def Mode.ordered : Mode → Bool
  | .asc => true
  | .desc => true
  | _ => false

inductive Dir where
  | asc
  | desc
  deriving DecidableEq, Repr

/-- `mode_for_direction`. -/
def modeFor : Dir → Mode
  | .asc => .asc
  | .desc => .desc

inductive Scope where
  | collection
  | group
  deriving DecidableEq, Repr

/-- `scope_for`. -/
def scopeFor (group : Bool) : Scope := if group then .group else .collection

structure IField where
  path : Field
  mode : Mode
  deriving DecidableEq, Repr

/-- `IndexDefinition`. -/
structure Index where
  coll : Nat
  scope : Scope
  fields : List IField
  deriving DecidableEq, Repr

structure OrderC where
  path : Field
  dir : Dir
  deriving DecidableEq, Repr

/-- `Requirement`. -/
structure Req where
  eq : List Field
  contains : Option Field
  order : List OrderC
  eqOrdered : Bool
  /-- Whether the array filter is `array-contains-any` rather than a plain `array-contains`. -/
  containsAny : Bool
  deriving DecidableEq, Repr

/-- `IndexSet`: the composites in the order they were added and the effective single-field
modes of each (collection group, field). -/
structure ISet where
  composites : List Index
  modes : Nat → Field → List (Scope × Mode)

/-- `has_single_field_mode`. -/
def hasMode (s : ISet) (coll : Nat) (f : Field) (group : Bool) (m : Mode) : Bool :=
  (s.modes coll f).any fun p => p.1 == scopeFor group && p.2 == m

/-- `IndexSet::is_exempt`. -/
def isExempt (s : ISet) (coll : Nat) (f : Field) (group : Bool) : Bool :=
  !(s.modes coll f).any fun p => (p.1 == .group) == group

/-! ## `composite_fields_serve` -/

/-- The direction the query asks of `__name__` (`requested_name_direction`). -/
def nameDirOf (order : List OrderC) : Dir :=
  match order.find? (·.path == NAME) with
  | some o => o.dir
  | none => .asc

/-- The loop over the non-`__name__` index fields after the equality prefix (and the array
field): each must be the next non-`__name__` order with its direction, and no order may be left.
On success it returns `last_ordered`. -/
def matchOrder : List IField → List OrderC → Option (Option Mode)
  | [], [] => some none
  | [], _ :: _ => none
  | _ :: _, [] => none
  | f :: fs, o :: os =>
    if f.path == o.path && f.mode == modeFor o.dir then
      match matchOrder fs os with
      | some (some m) => some (some m)
      | some none => some (some f.mode)
      | none => none
    else none

/-- The tail of `composite_fields_serve`: the ordered fields, then the `__name__` check. -/
def suffixServes (rest : List IField) (order : List OrderC) : Bool :=
  match matchOrder (rest.filter (·.path != NAME)) (order.filter (·.path != NAME)) with
  | none => false
  | some last =>
    let wanted := modeFor (nameDirOf order)
    match rest.find? (·.path == NAME) with
    | some n => n.mode == wanted
    | none =>
      match last with
      | some m => m == wanted
      | none => true

/-- `composite_serves`. -/
def compositeServes (idx : Index) (r : Req) (coll : Nat) (group : Bool) : Bool :=
  if idx.coll != coll || (idx.scope == .collection && group) then false
  else if idx.fields.length < r.eq.length then false
  else
    let pre := idx.fields.take r.eq.length
    if pre.any (fun f => !(r.eq.contains f.path))
        || r.eq.any (fun p => !(pre.any (·.path == p)))
        || pre.any (fun f => !f.mode.ordered) then false
    else
      let rest := idx.fields.drop r.eq.length
      match r.contains with
      | none => suffixServes rest r.order
      | some c =>
        match rest with
        | f :: t => f.path == c && f.mode == .contains && suffixServes t r.order
        | [] => false

/-! ## `automatic_index_for` -/

/-- `single_field_index`: `(field mode, __name__ nameMode)`. -/
def singleFieldIndex (coll : Nat) (group : Bool) (f : Field) (m nm : Mode) : Index :=
  ⟨coll, scopeFor group, [⟨f, m⟩, ⟨NAME, nm⟩]⟩

/-- The fields a requirement touches besides `__name__`. -/
def touched (r : Req) : List Field :=
  (r.eq ++ r.contains.toList ++ (r.order.filter (·.path != NAME)).map (·.path)).eraseDups

/-- The mode `automatic_index_for` picks for the one touched field `f`, before checking that
it is enabled. `prod` is `recorded_refusals` (production's rules, Standard, collection scope):
there one equality, with nothing but `__name__` ordered, descending, is served only by the
field's descending mode; otherwise any enabled ordered mode serves an equality, preferring the
requested `__name__` direction. -/
def autoMode (r : Req) (s : ISet) (coll : Nat) (group : Bool) (prod : Bool) (f : Field) :
    Option Mode :=
  let nd := nameDirOf r.order
  let ordered := r.order.find? (·.path == f)
  if r.contains.isSome then (if ordered.isSome then none else some .contains)
  else
    match ordered with
    | some o => if o.dir != nd then none else some (modeFor o.dir)
    | none =>
      if prod && nd == .desc && r.eq.length == 1 && !r.eqOrdered then some .desc
      else [modeFor nd, .asc, .desc].find? (fun m => hasMode s coll f group m)

def automaticIndexFor (r : Req) (s : ISet) (coll : Nat) (group : Bool) (prod : Bool) :
    Option Index :=
  let t := touched r
  if t.length > 1 then none
  else
    let nd := nameDirOf r.order
    let nm := modeFor nd
    match t with
    | [] => if nd == .desc then none else some ⟨coll, scopeFor group, [⟨NAME, nm⟩]⟩
    | f :: _ =>
      if isExempt s coll f group then none
      else
        match autoMode r s coll group prod f with
        | none => none
        | some m => if hasMode s coll f group m then some (singleFieldIndex coll group f m nm) else none

/-! ## `merged_indexes_for` -/

/-- The equality fields an explicit composite serves: its longest prefix of ordered fields
that are equality fields. -/
def servedPrefix (r : Req) (idx : Index) : List Field :=
  (idx.fields.takeWhile (fun f => r.eq.contains f.path && f.mode.ordered)).map (·.path)

/-- The sub-requirement a member must serve: some equality fields, optionally the array
field, and the same order. -/
def subReqC (r : Req) (eqs : List Field) (c : Option Field) : Req := ⟨eqs, c, r.order, false, false⟩

/-- The sub-requirement of equality fields only. -/
def subReq (r : Req) (eqs : List Field) : Req := subReqC r eqs none

/-- What a member covers (`Cover`): an equality filter on a field, by an ordered index field,
or the array filter, by a contains index field. -/
inductive Kind where
  | eq
  | contains
  deriving DecidableEq, Repr

abbrev Cov := Kind × Field

/-- The equality filters on `fs`. -/
def eqCov (fs : List Field) : List Cov := fs.map (Kind.eq, ·)

/-- The array filter on `c`, if any. -/
def containsCov (c : Option Field) : List Cov := c.toList.map (Kind.contains, ·)

/-- Whether a composite may carry the array field after its served prefix: only in the
recorded phase, with nothing but `__name__` ordered, ascending (the shape production
recorded). -/
def carryOk (r : Req) (recorded : Bool) : Bool :=
  recorded && r.order.all (·.path == NAME) && nameDirOf r.order == .asc

/-- The array field, when the shape allows it (`carryOk`) and the composite's field right after
the served prefix is the query's array field in contains mode (`carries_contains`). -/
def carriedContains (r : Req) (recorded : Bool) (idx : Index) (served : List Field) :
    Option Field :=
  if carryOk r recorded then
    match r.contains with
    | some c =>
      match idx.fields[served.length]? with
      | some f => if f.path == c && f.mode == .contains then some c else none
      | none => none
    | none => none
  else none

/-- Candidate members from the composites, in list order: the served prefix, followed by the
array field when the composite carries it there (`carriedContains`). The cover set is a
`BTreeSet` in Rust; `eraseDups` keeps its size. -/
def compositeCandidates (r : Req) (s : ISet) (coll : Nat) (group : Bool) (recorded : Bool) :
    List (List Cov × Index) :=
  s.composites.filterMap fun idx =>
    let served := servedPrefix r idx
    let c := carriedContains r recorded idx served
    if served.isEmpty then none
    else if compositeServes idx (subReqC r served c) coll group then
      some ((eqCov served ++ containsCov c).eraseDups, idx)
    else none

/-- One step of a stable sort by decreasing cover count (`sort_by_key` with `Reverse`). -/
def insertDesc (x : List Cov × Index) : List (List Cov × Index) → List (List Cov × Index)
  | [] => [x]
  | y :: ys => if y.1.length > x.1.length then y :: insertDesc x ys else x :: y :: ys

def sortDesc : List (List Cov × Index) → List (List Cov × Index)
  | [] => []
  | x :: xs => insertDesc x (sortDesc xs)

/-- Ascending insertion sort of field paths (`Vec::sort`). -/
def insertField (x : Field) : List Field → List Field
  | [] => [x]
  | y :: ys => if y < x then y :: insertField x ys else x :: y :: ys

def sortFields : List Field → List Field
  | [] => []
  | x :: xs => insertField x (sortFields xs)

/-- The automatic single-field candidates, only when nothing but `__name__` is ordered: each
equality field whose index in the requested `__name__` direction is enabled, and the array
field through its contains index (whose `__name__` runs in the requested direction). The
contains member is taken for an ascending `__name__`, after the equality members (as before
the recorded rules); in the recorded phase also for a descending one when the array filter is a
plain array-contains, before the equality members. -/
def autoCandidates (r : Req) (s : ISet) (coll : Nat) (group : Bool) (recorded : Bool) :
    List (List Cov × Index) :=
  if r.order.all (·.path == NAME) then
    let nd := nameDirOf r.order
    let nm := modeFor nd
    let eqs := (sortFields r.eq).filterMap fun f =>
      if !isExempt s coll f group && hasMode s coll f group nm then
        some ([(Kind.eq, f)], singleFieldIndex coll group f nm nm)
      else none
    let cs := match r.contains with
      | some c =>
        if !isExempt s coll c group && hasMode s coll c group .contains &&
            (nd == .asc || (recorded && !r.containsAny)) then
          [([(Kind.contains, c)], singleFieldIndex coll group c .contains nm)]
        else []
      | none => []
    if nd == .desc then cs ++ eqs else eqs ++ cs
  else []

def candidates (r : Req) (s : ISet) (coll : Nat) (group : Bool) (recorded : Bool) :
    List (List Cov × Index) :=
  sortDesc (compositeCandidates r s coll group recorded) ++ autoCandidates r s coll group recorded

/-- The greedy cover: a candidate whose filters are all covered is skipped, any other is taken. -/
def greedy : List Cov → List (List Cov × Index) → List Cov × List Index
  | covered, [] => (covered, [])
  | covered, p :: rest =>
    if p.1.all (· ∈ covered) then greedy covered rest
    else
      let res := greedy (covered ++ p.1) rest
      (res.1, p.2 :: res.2)

/-- The filters a merge must cover. -/
def wanted (r : Req) : List Cov := eqCov r.eq ++ containsCov r.contains

/-- `members` in Rust: the equality fields plus the array field. -/
def wantedCount (r : Req) : Nat := r.eq.length + (if r.contains.isSome then 1 else 0)

/-- `merge_members`: one merge attempt. -/
def mergeMembers (r : Req) (s : ISet) (coll : Nat) (group : Bool) (recorded : Bool) :
    Option (List Index) :=
  let res := greedy [] (candidates r s coll group recorded)
  if (wanted r).all (· ∈ res.1) && res.1.all (· ∈ wanted r) then some res.2 else none

/-- `merged_indexes_for`: the merge as before the recorded rules, or else, at collection scope
only, with them. -/
def mergedIndexesFor (r : Req) (s : ISet) (coll : Nat) (group : Bool) : Option (List Index) :=
  if wantedCount r < 2 || r.eqOrdered then none
  else
    match mergeMembers r s coll group false with
    | some ms => some ms
    | none => if group then none else mergeMembers r s coll group true

/-! ## `decide_disjunct` for one disjunct -/

inductive Policy where
  | production
  | report
  | emulator
  deriving DecidableEq, Repr

inductive Edition where
  | standard
  | enterprise
  deriving DecidableEq, Repr

/-- `IndexValidationPolicy::production_rules`. -/
def Policy.productionRules : Policy → Bool
  | .emulator => false
  | _ => true

/-- `IndexValidationPolicy::assumes_missing_indexes`. -/
def Policy.assumes : Policy → Bool
  | .production => false
  | _ => true

inductive Decision where
  | use (i : Index)
  | merge (ms : List Index)
  | missing (req : Index)
  | assumed (req : Index)
  | fullScan (req : Index)
  deriving DecidableEq, Repr

/-- `required_index`. -/
def requiredIndex (r : Req) (coll : Nat) (group : Bool) : Index :=
  ⟨coll, scopeFor group,
    (sortFields r.eq).map (fun f => ⟨f, .asc⟩) ++ r.contains.toList.map (fun c => ⟨c, .contains⟩)
      ++ r.order.map (fun o => ⟨o.path, modeFor o.dir⟩)⟩

def decideReq (r : Req) (s : ISet) (coll : Nat) (group : Bool) (p : Policy) (e : Edition) :
    Decision :=
  match automaticIndexFor r s coll group (p.productionRules && e == .standard && !group) with
  | some a => .use a
  | none =>
    match s.composites.find? (fun i => compositeServes i r coll group) with
    | some i => .use i
    | none =>
      match (if p.productionRules then mergedIndexesFor r s coll group else none) with
      | some ms => .merge ms
      | none =>
        let q := requiredIndex r coll group
        if p.assumes && e == .standard then .assumed q
        else
          match e with
          | .standard => .missing q
          | .enterprise => .fullScan q

/-- Whether the decision serves the query from configured indexes. -/
def Decision.served : Decision → Bool
  | .use _ => true
  | .merge _ => true
  | _ => false

/-! ## `requirement_for` and `effective_order_by` for one conjunction -/

inductive Filter where
  /-- `field == value`; with `NAME` an equality on the document name. -/
  | eq (f : Field)
  /-- `field IS NULL` (a unary equality). -/
  | isNull (f : Field)
  | contains (f : Field)
  /-- `field array-contains-any [value]` (one disjunct of the DNF keeps it as such). -/
  | containsAny (f : Field)
  /-- `field > value`; with `NAME` a range on the document name. -/
  | gt (f : Field)
  deriving DecidableEq, Repr

structure Query where
  coll : Nat
  group : Bool
  filters : List Filter
  orderBy : List OrderC
  deriving DecidableEq, Repr

/-- Appends unless present (`if !equality.contains(field) { push }`). -/
def addUniq (l : List Field) (f : Field) : List Field := if l.contains f then l else l ++ [f]

def eqFields (fs : List Filter) : List Field :=
  fs.foldl (fun acc a =>
    match a with
    | .eq f => if f == NAME then acc else addUniq acc f
    | .isNull f => if f == NAME then acc else addUniq acc f
    | _ => acc) []

/-- The array filter's field and whether it is `array-contains-any`; the last array atom wins. -/
def arrayFilter (fs : List Filter) : Option (Field × Bool) :=
  fs.foldl (fun acc a =>
    match a with
    | .contains f => some (f, false)
    | .containsAny f => some (f, true)
    | _ => acc) none

def containsField (fs : List Filter) : Option Field := (arrayFilter fs).map (·.1)

/-- `Query::inequality_fields` (a `BTreeSet`, so sorted and without duplicates). -/
def ineqFields (fs : List Filter) : List Field :=
  sortFields (fs.filterMap (fun a => match a with | .gt f => some f | _ => none)).eraseDups

def effectiveOrder (q : Query) : List OrderC :=
  let last := match q.orderBy.getLast? with
    | some o => o.dir
    | none => .asc
  let extra := ((ineqFields q.filters).filter
      (fun f => f != NAME && !(q.orderBy.any (·.path == f)))).map (fun f => ⟨f, last⟩)
  let out := q.orderBy ++ extra
  if out.any (·.path == NAME) then out else out ++ [⟨NAME, last⟩]

def reqOf (q : Query) : Req :=
  let eq := eqFields q.filters
  let eff := effectiveOrder q
  ⟨eq, containsField q.filters, eff.filter (fun o => !(eq.contains o.path)),
    eff.any (fun o => eq.contains o.path), ((arrayFilter q.filters).map (·.2)).getD false⟩

def decideQuery (q : Query) (s : ISet) (p : Policy) (e : Edition) : Decision :=
  decideReq (reqOf q) s q.coll q.group p e

end IM
