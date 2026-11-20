import SingleIndex

/-!
One pipe-separated line per query after the case-count header. Columns are label,
collection, scope, policy, edition, atoms, explicit orders, aggregations, override
operations, composites, requirement equalities, membership, requirement order,
suggested index, base decision, and public (head) decision. Lists use commas, with
"-" for empty. Overrides and composites use ";" between entries. An override
is path=modes (empty modes are allowed, "*" is the default) or path!scope for
an exemption. "C" and "G" denote collection and collection-group scope.

An index is collection/scope/fields, with path:mode fields. Candidate and
suggested indexes also carry ~serves~capacity~necessity, where serves is the
Lean model of the public predicate (0 or 1) and shape errors are written
as "ok", "fields", "arrays", or "unnecessary". Decisions are tag:index, or
merge:index;index;... in member order. Each array-contains-any uses a singleton
value so there is one DNF arm. "eqarray" uses [z] and membership uses z.
-/

open SI

inductive Override where
  | set (path : Path) (modes : Modes)
  | exempt (path : Path) (scope : Scope)

structure Case where
  label : String
  collection : String := localCollection
  scope : Scope := .collection
  policy : Policy := .production
  edition : Edition := .standard
  atoms : List Atom := []
  order : List Clause := []
  aggregations : List (String × Path) := []
  overrides : List Override := []
  composites : List Index := []
  baseMerge : Option (List Index) := none

def Case.requirement (c : Case) : Requirement :=
  let effective := effectiveOrder c.atoms c.order
  requirementForAggregation c.atoms effective <|
    c.aggregations.filterMap fun (kind, p) => if kind == "count" then none else some p

def Case.lookup (c : Case) : Overrides :=
  c.overrides.foldl (fun lookup override coll path =>
    if coll != c.collection then lookup coll path else
    match override with
    | .set p modes => if path == p then some modes.eraseDups else lookup coll path
    | .exempt p scope =>
      if path == p then some ((singleFieldModes lookup coll path).filter (·.1 != scope))
      else lookup coll path) defaults

def Case.conjunction (c : Case) : Bool :=
  let paths := c.atoms.map Prod.fst
  c.aggregations.isEmpty && paths.eraseDups.length == paths.length &&
    c.atoms.all (fun (p, k) => p != name && [Kind.eq, .eqArray, .array].contains k) &&
    (c.atoms.filter (·.2 == .array)).length ≤ 1

def Case.singleEquality (c : Case) : Bool :=
  c.atoms.length == 1 && c.atoms.all (fun a => [Kind.eq, .eqArray].contains a.2)

def list (xs : List String) (separator : String := ",") : String :=
  if xs.isEmpty then "-" else String.intercalate separator xs

def path (p : Path) : String := String.intercalate "." p

def direction : Direction → String
  | .asc => "asc"
  | .desc => "desc"

def mode : Mode → String
  | .ordered d => direction d
  | .contains => "contains"
  | .vector dim => s!"v{dim}"

def renderScope : Scope → String
  | .collection => "C"
  | .group => "G"

def renderPolicy : Policy → String
  | .production => "production"
  | .report => "report"
  | .emulator => "emulator"

def renderEdition : Edition → String
  | .standard => "standard"
  | .enterprise => "enterprise"

def kind : Kind → String
  | .eq => "eq"
  | .eqArray => "eqarray"
  | .isNull => "null"
  | .isNan => "nan"
  | .array => "array"
  | .arrayAny => "any"
  | .inequality => "gt"
  | .other => "other"

def clauses (os : List Clause) : String := list (os.map fun (p, d) => s!"{path p}:{direction d}")

def index (i : Index) : String :=
  s!"{i.collection}/{renderScope i.scope}/{list (i.fields.map fun (p, m) => s!"{path p}:{mode m}")}"

def shape : Option ShapeError → String
  | none => "ok"
  | some .tooManyFields => "fields"
  | some .multipleArrays => "arrays"
  | some .unnecessary => "unnecessary"

def checked (i : Index) (r : Requirement) (c : Case) : String :=
  let serves := if compositeServes i r c.collection c.scope then "1" else "0"
  s!"{index i}~{serves}~{shape (checkCapacity i)}~{shape (checkNecessary i)}"

def decision : Decision → String
  | .useIndex i => s!"use:{index i}"
  | .merge members => s!"merge:{list (members.map index) ";"}"
  | .missing i => s!"missing:{index i}"
  | .assumed i => s!"assumed:{index i}"
  | .fullScan i => s!"fullscan:{index i}"

def changeText : Override → String
  | .set p modes =>
    let f := if p.isEmpty then "*" else path p
    s!"{f}={list (modes.map fun (s, m) => s!"{renderScope s}:{mode m}")}"
  | .exempt p s => s!"{path p}!{renderScope s}"

def Case.render (c : Case) : String :=
  let r := c.requirement
  let base := decideBase r c.lookup c.collection c.scope c.composites c.policy c.edition c.baseMerge
  let head := decideHead r c.lookup c.collection c.scope c.composites c.policy c.edition
    c.conjunction c.singleEquality c.baseMerge none
  String.intercalate "|" [c.label, c.collection, renderScope c.scope, renderPolicy c.policy, renderEdition c.edition,
    list (c.atoms.map fun (p, k) => s!"{path p}:{kind k}"), clauses c.order,
    list (c.aggregations.map fun (kind, p) => s!"{kind}:{path p}"),
    list (c.overrides.map changeText) ";",
    list (c.composites.map (checked · r c)) ";",
    list (r.equality.map path), r.array.map path |>.getD "-", clauses r.order,
    checked (requiredIndex r c.collection c.scope) r c, decision base, decision head]

local instance : Monad List where
  pure x := [x]
  bind xs f := xs.flatMap f

def contexts (c : Case) : List Case := do
  let scope ← [Scope.collection, .group]
  let policy ← [Policy.production, .report, .emulator]
  let edition ← [Edition.standard, .enterprise]
  pure { c with scope, policy, edition }

def mkIndex (fields : List Field) (s : Scope := .collection) : Index :=
  ⟨localCollection, s, fields⟩

def directions := [Direction.asc, Direction.desc]

def orders : List (List Clause) :=
  [[]] ++ (directions.map fun d => [(["n"], d)]) ++
    (directions.flatMap fun d => directions.map fun e => [(["n"], d), (["m"], e)])

def matrix : List Case := do
  let n ← List.range 4
  let arr ← [[], [(tags, Kind.array)], [(tags, .arrayAny)]]
  let order ← orders
  let d ← directions
  let c ← contexts {
    label := "matrix", atoms := ([a, b, ["c"]].take n).map (·, .eq) ++ arr,
    order := order ++ [(name, d)], overrides := [.set [] []] }
  let exact := requiredIndex c.requirement c.collection c.scope
  pure { c with composites := [exact] }

def variations : List Case := do
  let label ← ["builtin", "exact", "wrong-direction", "permuted", "repeated", "other-scope",
    "other-collection", "implicit-name", "wrong-kind"]
  let d ← directions
  let arr ← [[], [(tags, Kind.array)], [(tags, .arrayAny)]]
  let c ← contexts {
    label, atoms := [(b, .eq), (a, .eq)] ++ arr,
    order := [(["n"], d), (name, d)], overrides := [.set [] []] }
  let correct := requiredIndex c.requirement c.collection c.scope
  let pre := [(b, descending), (a, ascending)]
  let tail := arrayKeys c.requirement.array ++ [(["n"], .ordered d)]
  let comps := match label with
    | "builtin" => []
    | "exact" => [correct]
    | "wrong-direction" => [{ correct with fields := pre ++ tail ++ [key d.flip] }]
    | "permuted" => [{ correct with fields := pre ++ tail ++ [key d] }]
    | "repeated" => [{ correct with fields := pre ++ [(a, ascending)] ++ tail ++ [key d] }]
    | "other-scope" => [{ correct with scope := if c.scope == .group then .collection else .group }]
    | "other-collection" => [{ correct with collection := "other" }]
    | "implicit-name" => [{ correct with fields := pre ++ tail }]
    | _ => [{ correct with fields := [(a, .contains), (b, ascending)] ++ tail ++ [key d] }]
  -- The repeated prefix is a one-member merge in the existing merge specification.
  let baseMerge := if label == "repeated" && arr.isEmpty then some comps else none
  pure { c with composites := comps, baseMerge, overrides := if label == "builtin" then [] else c.overrides }

def modeCases : List Case := do
  let shape ← ["eq", "array", "any", "order", "order-opposite", "overlap"]
  let d ← directions
  let config ← ["builtin", "no-asc", "no-desc", "no-contains", "exempt", "group-modes", "vector-only"]
  let c ← contexts { label := s!"{shape}/{config}", order := [(name, d)] }
  let p := if shape == "overlap" then tags else a
  let atoms := match shape with
    | "eq" => [(p, Kind.eq)]
    | "array" => [(p, .array)]
    | "any" => [(p, .arrayAny)]
    | "overlap" => [(p, .eqArray), (p, .array)]
    | _ => []
  let order := match shape with
    | "order" => [(p, d), (name, d)]
    | "order-opposite" => [(p, d.flip), (name, d)]
    | _ => c.order
  let overrides := match config with
    | "no-asc" => [.set p (builtIn.filter (·.2 != ascending))]
    | "no-desc" => [.set p (builtIn.filter (·.2 != descending))]
    | "no-contains" => [.set p (builtIn.filter (·.2 != .contains))]
    | "exempt" => [.exempt p c.scope]
    | "group-modes" => [.set p (builtIn.map fun (_, m) => (.group, m))]
    | "vector-only" => [.set p [(.collection, .vector 3), (.group, .vector 3)]]
    | _ => []
  -- The pre-existing path-keyed merge can cover both occurrences with one ordered index.
  let baseMerge := if shape == "overlap" && config == "no-contains" && c.scope == .collection
    then some [singleFieldIndex c.collection c.scope p (.ordered d) d] else none
  pure { c with atoms, order, overrides, baseMerge }

/-- Verdicts transcribed from the offline recordings, with only planner-relevant
configuration entries. The base and head predictions are still computed. -/
def recorded : List (Case × Bool) :=
  let primaryDesc := [(name, Direction.desc)]
  let plainEq := [(a, Kind.eq)]
  let tagsOnly := [(tags, Kind.array)]
  let qx (row : String) : Case := {
    label := "production/" ++ row, collection := "qx",
    composites := [⟨"qx", .collection, [(a, ascending), (b, ascending)]⟩,
      ⟨"qx", .collection, [(a, ascending), (["c"], ascending)]⟩,
      ⟨"qx", .collection, [(b, ascending), (["c"], ascending)]⟩,
      ⟨"qx", .collection, [(tags, .contains), (b, ascending)]⟩],
    overrides := [.set ["nx"] []] }
  let qcg : Index := ⟨"qcg", .group, [(a, ascending), (b, ascending)]⟩
  [
    ({ qx "name-descending-alone" with order := primaryDesc }, false),
    ({
       label := "production/name-descending-with-own-index", collection := "ord", order := primaryDesc,
       composites := [⟨"ord", .collection, [key .desc]⟩] }, true),
    ({
       label := "production/contains-alone-name-desc", collection := "imb", atoms := tagsOnly,
       order := primaryDesc }, true),
    ({
       label := "production/ascending-only/a-alone-name-desc", collection := "ima",
       atoms := plainEq, order := primaryDesc, overrides := [.set a [(.collection, ascending)]] }, false),
    ({ qx "array-contains-alone" with atoms := tagsOnly }, true),
    ({ qx "single-range-and-order" with atoms := [(["c"], .inequality)], order := [(["c"], .desc)] }, true),
    ({ qx "equality-and-name-descending" with atoms := plainEq, order := primaryDesc }, true),
    ({ qx "equality-and-array-contains-merge" with
       atoms := plainEq ++ tagsOnly, baseMerge := some
         [singleFieldIndex "qx" .collection a ascending .asc,
          singleFieldIndex "qx" .collection tags .contains .asc] }, true),
    ({ qx "range-and-name-order-descending" with
       atoms := [(["c"], .inequality)],
       order := [(["c"], .asc), (name, .desc)] }, false),
    ({ qx "array-contains-and-order" with atoms := tagsOnly, order := [(b, .asc)] }, true),
    ({ qx "array-contains-and-order-missing" with atoms := tagsOnly, order := [(["c"], .asc)] }, false),
    ({ qx "sum-with-composite" with atoms := plainEq, aggregations := [("sum", b)] }, true),
    ({ qx "sum-missing-composite" with atoms := plainEq, aggregations := [("sum", ["d"])] }, false),
    ({ qx "count-missing-composite" with
       atoms := [(["s"], .eq)], order := [(["d"], .asc)],
       aggregations := [("count", [])] }, false),
    ({ qx "exempted-field-equality" with atoms := [(["nx"], .eq)] }, false),
    ({ qx "collection-scope-composite-for-group" with
       scope := .group, atoms := plainEq,
       order := [(b, .asc)] }, false),
    ({
       label := "production/group-scope-composite-for-group", collection := "qcg", scope := .group,
       atoms := plainEq, order := [(b, .asc)], composites := [qcg] }, true),
    ({
       label := "production/group-scope-composite-for-collection", collection := "qcg",
       atoms := plainEq, order := [(b, .asc)], composites := [qcg] }, true),
    ({
       label := "production/group-only-override-group-equality", scope := .group,
       atoms := [(["n"], .eq)], overrides := [.set ["n"] [(.group, ascending)]] }, true),
    ({
       label := "production/group-only-override-collection-equality",
       atoms := [(["n"], .eq)], overrides := [.set ["n"] [(.group, ascending)]] }, false),
    ({
       label := "production/group-array-contains-without-group-index", collection := "qg",
       scope := .group, atoms := tagsOnly }, false)
  ]

#guard recorded.all fun (c, served) =>
  (decideHead c.requirement c.lookup c.collection c.scope c.composites c.policy c.edition
    c.conjunction c.singleEquality c.baseMerge none).isIndexed == served

#guard (recorded.filter fun (c, served) =>
  (decideBase c.requirement c.lookup c.collection c.scope c.composites c.policy c.edition
    c.baseMerge).isIndexed != served).map (·.1.label) ==
  ["production/ascending-only/a-alone-name-desc"]

def examples : List Case :=
  let primaryDesc := [(name, Direction.desc)]
  let plainEq := [(a, Kind.eq)]
  let tagsOnly := [(tags, Kind.array)]
  let descendingEq := {
    label := "finding/head-asc-only", atoms := plainEq, order := primaryDesc,
    overrides := [.set a [(.collection, ascending)]] : Case }
  let width := fun n => {
    label := s!"capacity/{n + 1}", edition := .enterprise,
    atoms := (manyEqualities n).map (·, Kind.eq), overrides := [.set [] []] : Case }
  [
    {
      label := "finding/group-composite", order := [(a, .asc), (name, .desc)],
      composites := [mkIndex [(a, ascending), key .desc] .group] },
    {
      label := "finding/name-before-order", order := [(a, .asc)],
      overrides := [.set [] []], composites := [mkIndex [key .asc, (a, ascending)]] },
    {
      label := "finding/first-name-wins", order := [(a, .asc)], overrides := [.set [] []],
      composites := [mkIndex [(a, ascending), key .asc, key .desc]] },
    {
      label := "finding/implicit-equality-name", atoms := plainEq, order := primaryDesc,
      overrides := [.set [] []], composites := [mkIndex [(a, ascending)]] },
    {
      label := "finding/implicit-array-name", atoms := tagsOnly, order := primaryDesc,
      overrides := [.set [] []], composites := [mkIndex [(tags, .contains)]] },
    {
      label := "finding/overlap", atoms := [(tags, .eqArray), (tags, .array)],
      composites := [mkIndex [(tags, .contains), key .asc]] },
    {
      label := "finding/overlap-composite-both-kinds", atoms := [(tags, .eqArray), (tags, .array)],
      overrides := [.set [] []], composites := [mkIndex [(tags, ascending), (tags, .contains), key .asc]] },
    {
      label := "finding/opposite-name", order := [(a, .asc), (name, .desc)],
      composites := [mkIndex [(a, ascending), key .desc]] },
    {
      label := "finding/repeated-order", policy := .emulator,
      order := [(a, .asc), (a, .desc), (name, .asc)],
      composites := [mkIndex [(a, ascending), key .asc]] },
    {
      label := "membership-and-order-same-path", atoms := tagsOnly, order := [(tags, .asc)],
      composites := [mkIndex [(tags, .contains), key .asc], mkIndex [(tags, ascending), key .asc]] },
    {
      label := "membership-and-order-two-keys", atoms := tagsOnly, order := [(tags, .asc)],
      composites := [mkIndex [(tags, .contains), (tags, ascending), key .asc]] },
    { label := "finding/primary-asc" },
    { label := "finding/primary-desc", order := primaryDesc },
    { descendingEq with label := "finding/equality-asc", order := [(name, .asc)] },
    { descendingEq with label := "finding/equality-desc-base", policy := .emulator },
    { descendingEq with
      label := "finding/equality-desc-flipped-mode",
      overrides := [.set a [(.collection, descending)]] },
    descendingEq,
    { descendingEq with
      label := "finding/head-composite-prevents-refusal",
      composites := [mkIndex [(a, descending), key .desc]] },
    {
      label := "automatic-before-composite", atoms := plainEq,
      composites := [mkIndex [(a, descending), key .asc]] },
    {
      label := "first-composite", atoms := plainEq, overrides := [.set [] []],
      composites := [mkIndex [(a, descending), key .asc], mkIndex [(a, ascending), key .asc]] },
    {
      label := "raw-shapes", order := [(a, .asc)], overrides := [.set [] []],
      composites := [mkIndex [], mkIndex [(a, .vector 3)], mkIndex [(a, .contains), (b, .contains)]] },
    width 99, width 100,
    { label := "implicit-inequality", atoms := [(b, .inequality), (a, .inequality)] },
    {
      label := "explicit-desc-implicit-inequality", atoms := [(b, .inequality), (a, .inequality)],
      order := [(["n"], .desc)] },
    { label := "name-equality", atoms := [(name, .eq)], order := primaryDesc },
    { label := "null-and-nan", atoms := [(b, .isNan), (a, .isNull)], overrides := [.set [] []] },
    {
      label := "equality-ordered", atoms := plainEq, order := [(a, .desc)],
      overrides := [.set a [(.collection, ascending)]] },
    {
      label := "aggregate-count", atoms := plainEq, order := primaryDesc,
      aggregations := [("count", [])], overrides := [.set a [(.collection, ascending)]] },
    {
      label := "aggregate-insert-and-dedup", atoms := plainEq ++ tagsOnly, order := [(["n"], .desc)],
      aggregations := [("avg", ["z"]), ("sum", a), ("avg", tags), ("sum", ["n"]),
        ("sum", ["m"]), ("avg", ["m"])], overrides := [.set [] []] },
    { label := "aggregate-one-field", aggregations := [("sum", a)] },
    {
      label := "override-ancestor", order := [(["map", "child"], .asc)],
      overrides := [.set [] [], .set ["map"] [(.collection, ascending)] ] },
    {
      label := "override-exact-empty", order := [(["map", "child"], .asc)],
      overrides := [.set ["map"] [(.collection, ascending)], .set ["map", "child"] []] },
    {
      label := "override-exempt-inherited", scope := .group, order := [(["map", "child"], .asc)],
      overrides := [.set ["map"] [(.group, ascending), (.collection, ascending)],
        .exempt ["map", "child"] .group] }
  ]

def main : IO Unit := do
  let cases := recorded.map Prod.fst ++ examples ++ matrix ++ variations ++ modeCases
  let out ← IO.getStdout
  out.putStrLn s!"# lean-single-index {cases.length}"
  for c in cases do
    out.putStrLn c.render
