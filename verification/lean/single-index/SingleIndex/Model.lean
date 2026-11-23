import SingleIndex.Spec

namespace SI

inductive Kind where
  | eq | eqArray | isNull | isNan | array | arrayAny | inequality | other
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

abbrev Atom := Path × Kind

def ascending : Mode := .ordered .asc
def descending : Mode := .ordered .desc

def sortPaths (paths : List Path) : List Path :=
  paths.mergeSort (fun a b => compare a b != .gt)

def effectiveOrder (atoms : List Atom) (explicit : List Clause) : List Clause :=
  let dir := (explicit.getLast?.map Prod.snd).getD .asc
  let implicitFields := sortPaths <| ((atoms.filterMap fun (p, k) =>
    if k == .inequality && p != name && !(explicit.any (·.1 == p)) then some p else none)).eraseDups
  explicit ++ implicitFields.map (·, dir) ++
    if explicit.any (·.1 == name) then [] else [(name, dir)]

def requirementFor (atoms : List Atom) (order : List Clause) : Requirement :=
  let eqs := ((atoms.filterMap fun (p, k) =>
    if p != name && [Kind.eq, .eqArray, .isNull, .isNan].contains k then some p else none)).eraseDups
  let arr := (atoms.reverse.find? fun a => [Kind.array, .arrayAny].contains a.2).map Prod.fst
  ⟨eqs, arr, order.filter (!eqs.contains ·.1), order.any (eqs.contains ·.1)⟩

/-- The input contains sum and average fields only; count adds no field. -/
def requirementForAggregation (atoms : List Atom) (order : List Clause)
    (aggregates : List Path) : Requirement :=
  let r := requirementFor atoms order
  let additional := (sortPaths aggregates.eraseDups).filter fun p =>
    !r.equality.contains p && r.array != some p && !(r.order.any (·.1 == p))
  let before := r.order.takeWhile (·.1 != name)
  { r with order := before ++ additional.map (·, .asc) ++ r.order.drop before.length }

def nonNameOrder (r : Requirement) : List Clause := r.order.filter (·.1 != name)

def requestedName (r : Requirement) : Direction :=
  ((r.order.find? (·.1 == name)).map Prod.snd).getD .asc

def orderFields (r : Requirement) : List Field :=
  (nonNameOrder r).map fun (p, d) => (p, .ordered d)

def requiredIndex (r : Requirement) (collection : String) (scope : Scope) : Index :=
  ⟨collection, scope, (sortPaths r.equality).map (·, ascending) ++
    r.array.toList.map (·, Mode.contains) ++ r.order.map (fun (p, d) => (p, .ordered d))⟩

abbrev Modes := List (Scope × Mode)
abbrev Overrides := String → Path → Option Modes

def builtIn : Modes := [(.collection, ascending), (.collection, descending), (.collection, .contains)]

/-- Recursing on the reversed segments looks up the exact path, its map ancestors,
and the empty path for the collection default. An empty override stops inheritance. -/
def inheritedModes (lookup : Overrides) (coll : String) : Path → Modes
  | [] => (lookup coll []).getD builtIn
  | p :: ps => (lookup coll (p :: ps).reverse).getD (inheritedModes lookup coll ps)

def singleFieldModes (lookup : Overrides) (coll : String) (p : Path) : Modes :=
  inheritedModes lookup coll p.reverse

def hasMode (modes : Modes) (scope : Scope) (mode : Mode) : Bool :=
  modes.contains (scope, mode)

def isExempt (modes : Modes) (scope : Scope) : Bool :=
  !(modes.any (·.1 == scope))

def singleFieldIndex (coll : String) (scope : Scope) (p : Path) (mode : Mode)
    (dir : Direction) : Index :=
  ⟨coll, scope, [(p, mode), key dir]⟩

def touched (r : Requirement) : List Path :=
  (r.equality ++ r.array.toList ++ (nonNameOrder r).map Prod.fst).eraseDups

def automaticChoices (r : Requirement) (p : Path) : List Mode :=
  let dir := requestedName r
  let ordered := r.order.find? (·.1 == p)
  if r.array.isSome then
    if ordered.isSome then [] else [.contains]
  else match ordered with
    | some (_, d) => if d == dir then [.ordered d] else []
    | none => [.ordered dir, ascending, descending]

def automaticIndexFor (r : Requirement) (lookup : Overrides) (coll : String)
    (scope : Scope) : Option Index :=
  let dir := requestedName r
  match touched r with
  | [] => if dir == .asc then some ⟨coll, scope, [key dir]⟩ else none
  | [p] =>
    let modes := singleFieldModes lookup coll p
    if isExempt modes scope then none else
      ((automaticChoices r p).find? (hasMode modes scope)).map
        (fun m => singleFieldIndex coll scope p m dir)
  | _ => none

def Mode.isOrdered : Mode → Bool
  | .ordered _ => true
  | _ => false

def equalityPrefix (fixed : List Field) (paths : List Path) : Bool :=
  fixed.all (fun f => paths.contains f.1 && f.2.isOrdered) &&
    paths.all (fun p => fixed.any (·.1 == p))

def afterArray (rest : List Field) (array : Option Path) : Option (List Field) :=
  match array, rest with
  | none, rest => some rest
  | some p, f :: tail => if f == (p, .contains) then some tail else none
  | some _, [] => none

def suffixServes (fields : List Field) (r : Requirement) : Bool :=
  let ordered := fields.filter (·.1 != name)
  let nameMode := ((fields.find? (·.1 == name)).or ordered.getLast?).map Prod.snd
  ordered == orderFields r && nameMode.all (· == .ordered (requestedName r))

def compositeFieldsServe (fields : List Field) (actual : Scope) (sameCollection : Bool)
    (scope : Scope) (r : Requirement) : Bool :=
  let n := r.equality.length
  sameCollection && !(actual == .collection && scope == .group) &&
    (n ≤ fields.length) && equalityPrefix (fields.take n) r.equality &&
    ((afterArray (fields.drop n) r.array).any (suffixServes · r))

def compositeServes (i : Index) (r : Requirement) (coll : String) (scope : Scope) : Bool :=
  compositeFieldsServe i.fields i.scope (i.collection == coll) scope r

inductive ShapeError where
  | tooManyFields | multipleArrays | unnecessary
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

def checkCapacity (i : Index) : Option ShapeError :=
  if i.fields.length > 100 then some .tooManyFields
  else if (i.fields.filter (·.2 == .contains)).length > 1 then some .multipleArrays
  else none

def checkNecessary (i : Index) : Option ShapeError :=
  if i.fields.length < 2 && !(i.fields.any fun (p, m) =>
    p == name || match m with | .vector _ => true | _ => false) then some .unnecessary else none

inductive Decision where
  | useIndex (index : Index)
  | merge (indexes : List Index)
  | missing (index : Index)
  | assumed (index : Index)
  | fullScan (index : Index)
  deriving DecidableEq, BEq, ReflBEq, LawfulBEq, Repr

def firstComposite (r : Requirement) (coll : String) (scope : Scope)
    (composites : List Index) : Option Index :=
  composites.find? (compositeServes · r coll scope)

def unserved (r : Requirement) (coll : String) (scope : Scope) (p : Policy)
    (e : Edition) : Decision :=
  let i := requiredIndex r coll scope
  if e == .enterprise then .fullScan i
  else if p == .production then .missing i else .assumed i

/-- Merge selection belongs to index-merge. This argument is the answer of that
stage, consulted only after both single-index attempts fail. -/
def decideBase (r : Requirement) (lookup : Overrides) (coll : String) (scope : Scope)
    (composites : List Index) (p : Policy) (e : Edition)
    (baseMerge : Option (List Index)) : Decision :=
  match (automaticIndexFor r lookup coll scope).or (firstComposite r coll scope composites) with
  | some i => .useIndex i
  | none =>
    match if p == .emulator then none else baseMerge with
    | some members => .merge members
    | none => unserved r coll scope p e

def refusesSingleEquality (r : Requirement) (lookup : Overrides) (coll : String) (scope : Scope)
    (composites : List Index) (plainConjunction recordedEquality : Bool) (base : Index) : Bool :=
  let direction := requestedName r
  recordedEquality && r.equality.length == 1 && r.array.isNone &&
    (r.order.all (·.1 == name)) &&
    (direction == .desc || (plainConjunction && !r.equalityOrdered)) &&
    base.fields.head?.any (fun field => field.2 != .ordered direction) &&
    automaticIndexFor r lookup coll scope == some base &&
    (firstComposite r coll scope composites).isNone

def stageB (p : Policy) (e : Edition) : Bool :=
  p != .emulator && e == .standard

def decideHead (r : Requirement) (lookup : Overrides) (coll : String) (scope : Scope)
    (composites : List Index) (p : Policy) (e : Edition) (conjunction recordedEquality : Bool)
    (baseMerge recordedMerge : Option (List Index)) : Decision :=
  let base := decideBase r lookup coll scope composites p e baseMerge
  if stageB p e then
    match base with
    | .useIndex i =>
      if refusesSingleEquality r lookup coll scope composites conjunction recordedEquality i
      then unserved r coll scope p e else base
    | .missing _ | .assumed _ =>
      if scope == .collection && conjunction then (recordedMerge.map Decision.merge).getD base
      else base
    | _ => base
  else base

end SI
