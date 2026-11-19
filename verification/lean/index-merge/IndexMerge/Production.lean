import IndexMerge.Corpus

/-!
# Recorded production verdicts

Every row that concerns the index-merge decision and can be read offline, with the verdict
production returned: served (`200`, gRPC `OK`) or refused for a missing index (`400`
`FAILED_PRECONDITION`, gRPC `9`). The `#guard` at the end fails the build when the model
disagrees with any of them (the head decision, `decideHead`); a second `#guard` pins the rows
the base decision alone contradicts.

Sources:

- `conformance/fs-query-index-production.json`, recorded against production Firestore with the
  indexes in `conformance/fs-query-index.indexes.json`; the queries are in
  `conformance/src/fs-query-index/programs/{indexes,explain,filters,grpc}.mjs`. Plan rows
  (`explain`) also name the members; production lists them in its own order, which the
  comparison already accepts as a divergence (`spec/compatibility/closure/evidence/
  FS-QUERY-INDEX-comparison.json`, decision S4), so members compare as a set.
- `tools/sdk-smoke/index-merge-oracle.mjs`, whose expected outcomes were asserted against
  production (2026-09-08) with the indexes in `conformance/firestore.indexes.json`.
- `conformance/fs-query-index-merge-production.json` (the index-merge observation, recorded
  2026-11-19, identical in both recordings) with the indexes in
  `conformance/fs-query-index-merge.indexes.json`; the queries are in
  `conformance/src/fs-query-index-merge/corpus.mjs`. Every query row and every plan row is
  listed; a served plan row also names the members.

Rows outside the model and therefore not listed: OR queries and other DNF expansions with
different disjuncts (`or-of-single-fields`, `or-needing-composite`), aggregations
(`sum-with-composite`, `sum-missing-composite`, `count-missing-composite`), the component-limit
refusals (`equalities-101`, `equalities-100-and-order`, `subcollection-equalities-100`), and the
oracle's two `__name__`-with-range rows, which canonicalization refuses (`INVALID_ARGUMENT`)
before any index is chosen. An `in` on one field expands to disjuncts of the same shape, so it
is listed as one of them; the oracle's `__name__ > … AND __name__ < …` has the same requirement
as one range on `__name__`.
-/

namespace IM

/-! ## `conformance/fs-query-index.indexes.json` -/

def qx := cid "qx"

def fsqiConfig : Config :=
  { composites := [
      ix (cid "ord") [("__name__", .desc)],
      ix (cid "mrg") [("category", .asc), ("star_rating", .asc), ("__name__", .asc)],
      ix (cid "mrg") [("city", .asc), ("star_rating", .asc), ("__name__", .asc)],
      ix qx [("a", .asc), ("b", .asc)],
      ix qx [("a", .asc), ("c", .asc)],
      ix qx [("b", .asc), ("c", .asc)],
      ix qx [("tags", .contains), ("b", .asc)],
      ix (cid "qcg") [("a", .asc), ("b", .asc)] .group]
    defaults := [(cid "pk", [])]
    overrides := [
      (cid "items", fid "n", [(.group, .asc)]),
      (qx, fid "nx", []),
      (cid "qg", fid "p",
        [(.collection, .asc), (.collection, .desc), (.group, .asc), (.group, .desc)])] }

def fsqi (row : String) (served : Bool) (q : Query) (plan : Option (List (List IField)) := none) :
    Case :=
  { label := row, query := q, config := fsqiConfig, production := some (served, row),
    productionPlan := plan }

def fl (names : List String) : List IField := names.map fun n => ⟨fid n, .asc⟩

def equalities (n : Nat) : List Filter := (List.range n).map fun i => eqF s!"e{i}"

def fsqiRows : List Case := [
  -- index-selection/automatic-and-merge
  fsqi "fs-query-index/index-selection/automatic-and-merge#single-equality" true
    (query qx [eqF "a"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#single-range-and-order" true
    (query qx [gtF "c"] [desc "c"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#single-order-descending" true
    (query qx [] [desc "c"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#array-contains-alone" true
    (query qx [hasF "tags"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#two-equalities-merge" true
    (query qx [eqF "a", eqF "b"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#three-equalities-merge" true
    (query qx [eqF "a", eqF "b", eqF "s"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#equality-and-array-contains-merge" true
    (query qx [eqF "a", hasF "tags"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#equalities-with-order-merged" true
    (query qx [eqF "a", eqF "b"] [asc "c"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#equality-and-name-descending" true
    (query qx [eqF "a"] [desc "__name__"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#equality-and-name-ascending" true
    (query qx [eqF "a"] [asc "__name__"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#name-descending-alone" false
    (query qx [] [desc "__name__"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#name-descending-with-own-index" true
    (query (cid "ord") [] [desc "__name__"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#name-range-descending" false
    (query qx [gtF "__name__"] [desc "__name__"]),
  fsqi "fs-query-index/index-selection/automatic-and-merge#in-merge" true
    (query qx [eqF "a", eqF "b"]),
  -- index-selection/composites
  fsqi "fs-query-index/index-selection/composites#equality-then-order" true
    (query qx [eqF "a"] [asc "b"]),
  fsqi "fs-query-index/index-selection/composites#equality-then-order-descending-missing" false
    (query qx [eqF "a"] [desc "b"]),
  fsqi "fs-query-index/index-selection/composites#two-ranges" true
    (query qx [gtF "a", gtF "b"]),
  fsqi "fs-query-index/index-selection/composites#two-ranges-order-reversed-missing" false
    (query qx [gtF "a", gtF "b"] [asc "b"]),
  fsqi "fs-query-index/index-selection/composites#two-orders" true
    (query qx [] [asc "a", asc "b"]),
  fsqi "fs-query-index/index-selection/composites#two-orders-missing" false
    (query qx [] [asc "b", asc "a"]),
  fsqi "fs-query-index/index-selection/composites#array-contains-and-order" true
    (query qx [hasF "tags"] [asc "b"]),
  fsqi "fs-query-index/index-selection/composites#array-contains-and-order-missing" false
    (query qx [hasF "tags"] [asc "c"]),
  fsqi "fs-query-index/index-selection/composites#equalities-with-order-one-missing" false
    (query qx [eqF "a", eqF "d"] [asc "c"]),
  fsqi "fs-query-index/index-selection/composites#equality-range-missing" false
    (query qx [eqF "s", gtF "c"]),
  fsqi "fs-query-index/index-selection/composites#equality-and-name-range" true
    (query qx [eqF "a", gtF "__name__"]),
  fsqi "fs-query-index/index-selection/composites#range-and-name-order-descending" false
    (query qx [gtF "c"] [asc "c", desc "__name__"]),
  -- index-selection/scopes-and-exemptions
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#exempted-field-equality" false
    (query qx [eqF "nx"]),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#exempted-field-order" false
    (query qx [] [asc "nx"]),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#wildcard-exempt-collection" false
    (query (cid "pk") [eqF "a"]),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-field-without-group-index" false
    (query (cid "qg") [eqF "n"] [] true),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-order-without-group-index" false
    (query (cid "qg") [] [asc "n"] true),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-order-descending-without-group-index"
    false (query (cid "qg") [] [desc "n"] true),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-array-contains-without-group-index"
    false (query (cid "qg") [hasF "tags"] [] true),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-scope-composite-for-group" true
    (query (cid "qcg") [eqF "a"] [asc "b"] true),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-scope-composite-for-collection"
    true (query (cid "qcg") [eqF "a"] [asc "b"]),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#collection-scope-composite-for-group"
    false (query qx [eqF "a"] [asc "b"] true),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-only-override-group-equality"
    true (query (cid "items") [eqF "n"] [] true),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-only-override-collection-equality"
    false (query (cid "items") [eqF "n"]),
  fsqi "fs-query-index/index-selection/scopes-and-exemptions#group-only-override-group-order" true
    (query (cid "items") [] [asc "n"] true),
  -- query-limits/components (collection ql; the subcollection row has a parent document,
  -- which does not change the collection group)
  fsqi "fs-query-index/query-limits/components#equalities-100" true
    (query (cid "ql") (equalities 100)),
  fsqi "fs-query-index/query-limits/components#equalities-99-and-order" false
    (query (cid "ql") (equalities 99) [asc "e0"]),
  fsqi "fs-query-index/query-limits/components#subcollection-equalities-99" true
    (query (cid "ql") (equalities 99)),
  -- explain plans
  fsqi "fs-query-index/explain/queries#merge-plan" true (query qx [eqF "a", eqF "b"])
    (some [fl ["a", "b"]]),
  fsqi "fs-query-index/explain/queries#merge-analyze" true (query qx [eqF "a", eqF "b"])
    (some [fl ["a", "b"]]),
  fsqi "fs-query-index/explain/queries#merge-with-order-plan" true
    (query qx [eqF "a", eqF "b"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/queries#merge-with-order-analyze" true
    (query qx [eqF "a", eqF "b"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/merge-order#larger-later-field-plan" true
    (query qx [eqF "a", eqF "b"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/merge-order#larger-later-field-analyze" true
    (query qx [eqF "a", eqF "b"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/merge-order#larger-earlier-field-plan" true
    (query qx [eqF "a", eqF "b"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/merge-order#larger-earlier-field-analyze" true
    (query qx [eqF "a", eqF "b"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/merge-order#filters-reversed-plan" true
    (query qx [eqF "b", eqF "a"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/merge-order#filters-reversed-analyze" true
    (query qx [eqF "b", eqF "a"] [asc "c"]) (some [fl ["b", "c"], fl ["a", "c"]]),
  fsqi "fs-query-index/explain/merge-order#automatic-members-plan" true
    (query qx [eqF "c", eqF "d"]) (some [fl ["d"], fl ["c"]]),
  fsqi "fs-query-index/explain/merge-order#automatic-members-analyze" true
    (query qx [eqF "c", eqF "d"]) (some [fl ["d"], fl ["c"]]),
  fsqi "fs-query-index/explain/merge-order#automatic-members-reversed-plan" true
    (query qx [eqF "d", eqF "c"]) (some [fl ["d"], fl ["c"]]),
  fsqi "fs-query-index/explain/merge-order#automatic-members-reversed-analyze" true
    (query qx [eqF "d", eqF "c"]) (some [fl ["d"], fl ["c"]]),
  fsqi "fs-query-index/explain/merge-order#three-automatic-members-plan" true
    (query qx [eqF "d", eqF "s", eqF "c"]) (some [fl ["d"], fl ["c"], fl ["s"]]),
  fsqi "fs-query-index/explain/merge-order#three-automatic-members-analyze" true
    (query qx [eqF "d", eqF "s", eqF "c"]) (some [fl ["d"], fl ["c"], fl ["s"]]),
  fsqi "fs-query-index/grpc/queries#merge" true (query qx [eqF "a", eqF "b"])]

/-! ## `tools/sdk-smoke/index-merge-oracle.mjs` with `conformance/firestore.indexes.json` -/

def mrg := cid "mrg"
def pk := cid "pk"

def oracleConfig : Config :=
  { composites := [
      ix (cid "ord") [("__name__", .desc)],
      ix mrg [("category", .asc), ("star_rating", .asc), ("__name__", .asc)],
      ix mrg [("city", .asc), ("star_rating", .asc), ("__name__", .asc)]]
    defaults := [(pk, [])]
    overrides := [(cid "items", fid "n", [(.group, .asc)])] }

def oracle (row : String) (served : Bool) (q : Query) : Case :=
  { label := row, query := q, config := oracleConfig,
    production := some (served, s!"index-merge-oracle#{row}") }

def oracleRows : List Case := [
  oracle "mrg-merge-two-composites" true
    (query mrg [eqF "category", eqF "city"] [asc "star_rating"]),
  oracle "mrg-merge-automatic-indexes" true (query mrg [eqF "category", eqF "city"]),
  oracle "mrg-no-editors-pick-composite" false
    (query mrg [eqF "category", eqF "city", eqF "editors_pick"] [asc "star_rating"]),
  oracle "mrg-direction-mismatch" false
    (query mrg [eqF "category", eqF "city"] [desc "star_rating"]),
  oracle "mrg-single-composite" true (query mrg [eqF "category"] [asc "star_rating"]),
  oracle "mrg-range-control" true (query mrg [eqF "category", gtF "star_rating"]),
  oracle "pk-exempt-field" false (query pk [eqF "n"]),
  oracle "pk-name-equality" true (query pk [eqF "__name__"]),
  oracle "pk-name-in" true (query pk [eqF "__name__"]),
  oracle "pk-name-range" true (query pk [gtF "__name__"]),
  oracle "pk-name-descending" false (query pk [] [desc "__name__"]),
  oracle "pk-name-range-descending" false (query pk [gtF "__name__"] [desc "__name__"]),
  oracle "pk-group-name-descending" false (query pk [] [desc "__name__"] true),
  oracle "mrg-automatic-descending-index" true (query mrg [eqF "category"] [desc "__name__"]),
  oracle "mrg-name-descending" false (query mrg [] [desc "__name__"]),
  oracle "mrg-group-name-descending" false (query mrg [] [desc "__name__"] true),
  oracle "ord-explicit-name-descending" true
    (query (cid "ord") [gtF "__name__"] [desc "__name__"]),
  oracle "pk-name-equality-and-exempt-field" false (query pk [eqF "__name__", eqF "n"])]

/-! ## `conformance/fs-query-index-merge.indexes.json`

Only the entries of the observation's collection groups: `imb` built-in, `ima` with `a`
ascending only (collection scope), `imx` with the composite `(a ASC, tags CONTAINS)` and `a`
and `tags` exempt, `imc` with the same composite and nothing exempt. The other entries of the
file concern other collection groups and do not change these decisions. -/

def imb := cid "imb"
def ima := cid "ima"
def imx := cid "imx"
def imc := cid "imc"

def mergeObsConfig : Config :=
  { composites := [
      ix imx [("a", .asc), ("tags", .contains)],
      ix imc [("a", .asc), ("tags", .contains)]]
    overrides := [
      (ima, fid "a", [(.collection, .asc)]),
      (imx, fid "a", []),
      (imx, fid "tags", [])] }

def mergeObs (program row : String) (served : Bool) (q : Query)
    (plan : Option (List (List IField)) := none) : Case :=
  let label := s!"fs-query-index-merge/shapes/{program}#{row}"
  { label, query := q, config := mergeObsConfig, production := some (served, label),
    productionPlan := plan }

def mergeObsRows : List Case := [
  -- shapes/builtin (imb)
  mergeObs "builtin" "f3-contains-name-desc" true (query imb [eqF "a", hasF "tags"] [desc "__name__"]),
  mergeObs "builtin" "f3-contains-name-asc" true (query imb [eqF "a", hasF "tags"] [asc "__name__"]),
  mergeObs "builtin" "contains-alone-name-desc" true (query imb [hasF "tags"] [desc "__name__"]),
  mergeObs "builtin" "a-alone-name-desc" true (query imb [eqF "a"] [desc "__name__"]),
  mergeObs "builtin" "f2-equalities-name-desc" true (query imb [eqF "a", eqF "b"] [desc "__name__"]),
  mergeObs "builtin" "f1-equalities-and-contains" true
    (query imb [eqF "a", eqF "b", hasF "tags"]),
  mergeObs "builtin" "f3-contains-name-desc-plan" true
    (query imb [eqF "a", hasF "tags"] [desc "__name__"])
    (some [[⟨fid "tags", .contains⟩], [⟨fid "a", .desc⟩]]),
  -- shapes/ascending-only (ima)
  mergeObs "ascending-only" "f2-equalities-name-desc" false
    (query ima [eqF "a", eqF "b"] [desc "__name__"]),
  mergeObs "ascending-only" "f2-equalities-name-asc" true
    (query ima [eqF "a", eqF "b"] [asc "__name__"]),
  mergeObs "ascending-only" "a-alone-name-desc" false (query ima [eqF "a"] [desc "__name__"]),
  mergeObs "ascending-only" "a-alone-name-asc" true (query ima [eqF "a"] [asc "__name__"]),
  mergeObs "ascending-only" "b-alone-name-desc" true (query ima [eqF "b"] [desc "__name__"]),
  mergeObs "ascending-only" "order-a-desc" false (query ima [] [desc "a"]),
  mergeObs "ascending-only" "order-a-asc" true (query ima [] [asc "a"]),
  mergeObs "ascending-only" "f2-equalities-name-desc-plan" false
    (query ima [eqF "a", eqF "b"] [desc "__name__"]),
  -- shapes/exempt-with-composite (imx)
  mergeObs "exempt-with-composite" "f1-equalities-and-contains" true
    (query imx [eqF "a", eqF "b", hasF "tags"]),
  mergeObs "exempt-with-composite" "a-and-contains" true (query imx [eqF "a", hasF "tags"]),
  mergeObs "exempt-with-composite" "b-alone" true (query imx [eqF "b"]),
  mergeObs "exempt-with-composite" "a-and-b" false (query imx [eqF "a", eqF "b"]),
  mergeObs "exempt-with-composite" "order-a-desc" false (query imx [] [desc "a"]),
  mergeObs "exempt-with-composite" "contains-alone" false (query imx [hasF "tags"]),
  mergeObs "exempt-with-composite" "f1-equalities-and-contains-plan" true
    (query imx [eqF "a", eqF "b", hasF "tags"])
    (some [[⟨fid "a", .asc⟩, ⟨fid "tags", .contains⟩], [⟨fid "b", .asc⟩]]),
  -- shapes/composite-not-exempt (imc)
  mergeObs "composite-not-exempt" "f1-equalities-and-contains" true
    (query imc [eqF "a", eqF "b", hasF "tags"]),
  mergeObs "composite-not-exempt" "a-and-contains" true (query imc [eqF "a", hasF "tags"])]

def productionRows : List Case := fsqiRows ++ oracleRows ++ mergeObsRows

/-- The members a decision plans, without `__name__` fields. -/
def Decision.planFields : Decision → List (List IField)
  | .use i => [i.fields.filter (·.path != NAME)]
  | .merge ms => ms.map fun i => i.fields.filter (·.path != NAME)
  | _ => []

def sameSet (a b : List (List IField)) : Bool := a.all (· ∈ b) && b.all (· ∈ a)

def Case.agreesWithProduction (c : Case) : Bool :=
  match c.production with
  | none => true
  | some (served, _) =>
    c.decision.served == served &&
      match c.productionPlan with
      | none => true
      | some plan => sameSet c.decision.planFields plan

/-- The rows the model contradicts; the build fails unless there are none. -/
def productionDisagreements : List String :=
  (productionRows.filter (!·.agreesWithProduction)).map (·.label)

#guard productionDisagreements == []

/-- The rows the base planner alone contradicts: exactly the three recorded shapes the head's
overrides exist for, (c), (a) and (b), and their plans. -/
def baseDisagreements : List String :=
  (productionRows.filter fun c =>
    match c.production with
    | some (served, _) => c.baseDecision.served != served
    | none => false).map (·.label)

#guard baseDisagreements == [
  "fs-query-index-merge/shapes/builtin#f3-contains-name-desc",
  "fs-query-index-merge/shapes/builtin#f3-contains-name-desc-plan",
  "fs-query-index-merge/shapes/ascending-only#a-alone-name-desc",
  "fs-query-index-merge/shapes/exempt-with-composite#f1-equalities-and-contains",
  "fs-query-index-merge/shapes/exempt-with-composite#f1-equalities-and-contains-plan"]
#guard mergeObsRows.length == 24
#guard productionRows.length == 101

end IM
