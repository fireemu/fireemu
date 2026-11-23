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

/-- Observation 2a P1. IN and OR have projected equality arms and the same requirement
as one ordinary equality. The corpus replayer reconstructs each source query. -/
def obs2P1Rows : List Case :=
  let ima := cid "ima"
  let igc := cid "igc"
  let iga := cid "iga"
  let a := fid "a"
  let make (id : Nat) (name : String) (q : Query) (scope : Scope) (mode : Mode)
      (served : Bool := false) (source : QuerySource := .plain) : Case :=
    let label := s!"fs-query-index-merge2/{id}/{name}"
    { label, query := q, config := { overrides := [(q.coll, a, [(scope, mode)])] },
      production := some (served, label), source }
  let collection := fun order => query ima [eqF "a"] order
  let byName := fun coll order => query coll [eqF "a"] [order] true
  [
    make 12 "count-a-name-desc" (collection [desc "__name__"]) .collection .asc false .count,
    make 13 "count-a" (collection []) .collection .asc true .count,
    make 14 "a-in-one-name-desc" (collection [desc "__name__"]) .collection .asc false .inOne,
    make 15 "a-or-two-name-desc" (collection [desc "__name__"]) .collection .asc false .orTwo,
    make 16 "a-order-a-desc" (collection [desc "a"]) .collection .asc,
    make 17 "a-order-a-asc-name-desc" (collection [asc "a", desc "__name__"]) .collection .asc,
    make 18 "a-is-null-name-desc" (query ima [.isNull a] [desc "__name__"]) .collection .asc,
    make 37 "group-a-name-asc" (byName igc (asc "__name__")) .group .asc true,
    make 38 "group-a-name-desc" (byName igc (desc "__name__")) .group .asc,
    make 39 "group-a-name-desc-plan" (byName igc (desc "__name__")) .group .asc,
    make 47 "group-a-name-asc" (byName iga (asc "__name__")) .group .desc,
    make 48 "group-a-name-desc" (byName iga (desc "__name__")) .group .desc true,
    make 49 "group-a-name-asc-plan" (byName iga (asc "__name__")) .group .desc
  ]

/-- Observation 2a P2–P6, including the previously served, reordered plans. -/
def obs2MergeRows : List Case :=
  let iga := cid "iga"
  let config : Config := { mergeObsConfig with overrides :=
    mergeObsConfig.overrides ++ [(iga, fid "a", [(.group, .desc)]),
      (iga, fid "tags", [(.group, .contains)])] }
  let make (id : Nat) (name : String) (q : Query) (served : Bool := true)
      (plan : Option (List (List IField)) := none) (source : QuerySource := .plain) : Case :=
    let label := s!"fs-query-index-merge2/{id}/{name}"
    { label, query := q, config, production := some (served, label), productionPlan := plan, source }
  let member := fun name mode => [IField.mk (fid name) mode]
  let a := eqF "a"
  let b := eqF "b"
  let t := hasF "tags"
  let any := Filter.containsAny (fid "tags")
  let shared := [a, eqF "tags", t]
  let ascName := [asc "__name__"]
  let descName := [desc "__name__"]
  [
    make 1 "a-and-b-name-asc-plan" (query imb [a, b] ascName) true
      (some [member "b" .asc, member "a" .asc]),
    make 2 "a-b-and-contains-plan" (query imb [a, b, t]) true
      (some [member "tags" .contains, member "b" .asc, member "a" .asc]),
    make 3 "a-and-contains-name-asc-plan" (query imb [a, t] ascName) true
      (some [member "tags" .contains, member "a" .asc]),
    make 5 "a-and-contains-any-name-desc" (query imb [a, any] descName),
    make 8 "a-and-shared-path-name-asc-plan" (query imb shared ascName) true
      (some [member "tags" .contains, member "a" .asc, member "tags" .asc]) .sharedArray,
    make 9 "a-and-shared-path-name-desc-plan" (query imb shared descName) true
      (some [member "tags" .contains, member "a" .desc, member "tags" .desc]) .sharedArray,
    make 20 "count-a-b-and-contains-name-desc" (query imx [a, b, t] descName) false none .count,
    make 21 "count-a-b-and-contains" (query imx [a, b, t]) true none .count,
    make 22 "a-b-and-contains-name-desc" (query imx [a, b, t] descName) false,
    make 23 "a-b-and-contains-name-desc-plan" (query imx [a, b, t] descName) false,
    make 24 "a-b-and-contains-any-name-desc" (query imx [a, b, any] descName) false,
    make 25 "a-b-and-contains-any" (query imx [a, b, any]),
    make 31 "a-b-and-contains-name-desc" (query imc [a, b, t] descName),
    make 32 "a-b-and-contains-plan" (query imc [a, b, t]) true
      (some [member "a" .asc ++ member "tags" .contains, member "b" .asc]),
    make 44 "group-a-and-contains-name-asc" (query iga [a, t] ascName true) false,
    make 45 "group-a-and-contains-name-desc" (query iga [a, t] descName true),
    make 46 "group-a-and-contains-name-desc-plan" (query iga [a, t] descName true) true
      (some [member "tags" .contains, member "a" .desc])
  ]

/-- Observation 2b query verdicts. Explain rows also pin the ordered members, their scopes and name direction in the planner representation. -/
def obs2bRows : List Case :=
  let row (catalog : String × Nat × Config) (step : String) (served : Bool)
      (filters : List Filter) (orders : List OrderC := []) (group := false)
      (source := QuerySource.plain) (plan : Option (List Index) := none) : Case :=
    let (program, coll, config) := catalog
    let label := program ++ "#" ++ step
    { label, query := query coll filters orders group, config, source,
      production := some (served, label), productionIndexes := plan }
  let a := eqF "a"
  let b := eqF "b"
  let c := eqF "c"
  let t := hasF "tags"
  let shared := eqF "tags"
  let up := [asc "__name__"]
  let down := [desc "__name__"]
  let ilp := cid "ilp"
  let ilpCfg : String × Nat × Config := ("fs-query-index-merge3/read-only/leap-second", ilp, {})
  let it1 := cid "it1"
  let it1Cfg : String × Nat × Config := ("fs-query-index-merge3/shapes/carrier-contains-automatic", it1,
    { composites := [ix it1 [("a", .asc), ("tags", .contains)]],
      overrides := [(it1, fid "a", [])] })
  let imd := cid "imd"
  let imdCfg : String × Nat × Config := ("fs-query-index-merge3/shapes/descending-only", imd, { overrides := [(imd, fid "a", [(.collection, .desc)])] })
  let iw2 := cid "iw2"
  let iw2Cfg : String × Nat × Config := ("fs-query-index-merge3/shapes/two-carriers", iw2,
    { composites := [ix iw2 [("a", .asc), ("tags", .contains)], ix iw2 [("b", .asc), ("tags", .contains)]],
      overrides := [(iw2, fid "a", []), (iw2, fid "b", []), (iw2, fid "tags", [])] })
  let iwd := cid "iwd"
  let iwdCfg : String × Nat × Config := ("fs-query-index-merge4/shapes/asc-and-desc-carriers", iwd,
    { composites := [ix iwd [("a", .asc), ("tags", .contains)], ix iwd [("a", .desc), ("tags", .contains)]],
      overrides := [(iwd, fid "a", []), (iwd, fid "tags", [])] })
  let io1 := cid "io1"
  let io1Cfg : String × Nat × Config := ("fs-query-index-merge4/shapes/carrier-tags-ordered-only", io1,
    { composites := [ix io1 [("a", .asc), ("tags", .contains)]],
      overrides := [(io1, fid "a", []), (io1, fid "tags", [(.collection, .asc), (.collection, .desc)])] })
  let ilw := cid "ilw"
  let ilwCfg : String × Nat × Config := ("fs-query-index-merge5/read-only/second-60-writes", ilw, {})
  let ig2 := cid "ig2"
  let ig2Cfg : String × Nat × Config := ("fs-query-index-merge5/shapes/group-contains-only", ig2,
    { composites := [ix ig2 [("a", .asc), ("tags", .contains)]],
      overrides := [(ig2, fid "a", []), (ig2, fid "tags", [(.group, .contains)])] })
  let i2p := cid "i2p"
  let i2pCfg : String × Nat × Config := ("fs-query-index-merge5/shapes/two-field-prefix", i2p,
    { composites := [ix i2p [("a", .asc), ("b", .asc), ("tags", .contains)]],
      overrides := [(i2p, fid "a", []), (i2p, fid "b", []), (i2p, fid "tags", [])] })
  let irv := cid "irv"
  let irvCfg : String × Nat × Config := ("fs-query-index-merge6/shapes/collection-composite-group-query", irv,
    { composites := [ix irv [("a", .asc), ("__name__", .desc)]],
      overrides := [(irv, fid "a", [])] })
  let icm := cid "icm"
  let icmCfg : String × Nat × Config := ("fs-query-index-merge6/shapes/composite-member", icm,
    { composites := [ix icm [("a", .asc), ("__name__", .desc)]],
      overrides := [(icm, fid "a", [])] })
  let ig1 := cid "ig1"
  let ig1Cfg : String × Nat × Config := ("fs-query-index-merge6/shapes/group-composite-collection-query", ig1,
    { composites := [ix ig1 [("a", .asc), ("__name__", .desc)] .group],
      overrides := [(ig1, fid "a", [])] })
  let ip1 := cid "ip1"
  let ip1Cfg : String × Nat × Config := ("fs-query-index-merge7/shapes/descending-prefix-carrier", ip1,
    { composites := [ix ip1 [("a", .desc), ("tags", .contains)]],
      overrides := [(ip1, fid "a", []), (ip1, fid "tags", [])] })
  let igx := cid "igx"
  let igxCfg : String × Nat × Config := ("fs-query-index-merge7/shapes/group-carrier", igx,
    { composites := [ix igx [("a", .asc), ("tags", .contains)] .group],
      overrides := [(igx, fid "a", []), (igx, fid "tags", []), (igx, fid "b", [(.collection, .asc), (.group, .asc)])] })
  let igy := cid "igy"
  let igyCfg : String × Nat × Config := ("fs-query-index-merge8/shapes/group-carrier-collection-readiness", igy,
    { composites := [ix igy [("a", .asc), ("tags", .contains)] .group],
      overrides := [(igy, fid "a", []), (igy, fid "tags", []), (igy, fid "b", [(.collection, .asc), (.group, .asc)])] })
  let is1 := cid "is1"
  let is1Cfg : String × Nat × Config := ("fs-query-index-merge8/shapes/shared-path-ascending-only", is1, { overrides := [(is1, fid "a", [(.collection, .asc)]), (is1, fid "tags", [(.collection, .contains)])] })
  let is2 := cid "is2"
  let is2Cfg : String × Nat × Config := ("fs-query-index-merge8/shapes/shared-path-descending-only", is2, { overrides := [(is2, fid "a", [(.collection, .desc)]), (is2, fid "tags", [(.collection, .contains)])] })
  [
    row ilpCfg "p7-leap-eq" true [eqF "t"],
    row ilpCfg "p7-leap-ge" true [gtF "t"],
    row ilpCfg "p7-leap-le" true [gtF "t"],
    row ilpCfg "p7-leap-gt" true [gtF "t"],
    row ilpCfg "p7-leap-lt" true [gtF "t"],
    row ilpCfg "p7-second-60-eq" true [eqF "t"],
    row ilpCfg "p7-second-60-ge" true [gtF "t"],
    row ilpCfg "p7-second-60-le" true [gtF "t"],
    row it1Cfg "a-b-and-contains" true [a, b, t],
    row it1Cfg "a-b-and-contains-plan" true [a, b, t] (plan := some [ix it1 [("a", .asc), ("tags", .contains)], ix it1 [("b", .asc), ("__name__", .asc)]]),
    row it1Cfg "a-b-and-contains-name-desc" false [a, b, t] down,
    row it1Cfg "count-a-b-and-contains" true [a, b, t] (source := .count),
    row it1Cfg "a-and-contains" true [a, t],
    row it1Cfg "contains" true [t],
    row it1Cfg "order-a-desc" false [] [desc "a"],
    row imdCfg "a-name-asc" false [a] up,
    row imdCfg "a" false [a],
    row imdCfg "a-name-asc-plan" false [a] up,
    row imdCfg "a-name-desc" true [a] down,
    row imdCfg "a-and-b-name-asc" false [a, b] up,
    row imdCfg "a-and-b-name-asc-plan" false [a, b] up,
    row imdCfg "a-and-b-name-desc" true [a, b] down,
    row imdCfg "order-a-asc" false [] [asc "a"],
    row imdCfg "order-a-desc" true [] [desc "a"],
    row iw2Cfg "a-b-and-contains" true [a, b, t],
    row iw2Cfg "a-b-and-contains-plan" true [a, b, t] (plan := some [ix iw2 [("b", .asc), ("tags", .contains)], ix iw2 [("a", .asc), ("tags", .contains)]]),
    row iw2Cfg "a-b-and-contains-name-desc" false [a, b, t] down,
    row iw2Cfg "count-a-b-and-contains" true [a, b, t] (source := .count),
    row iw2Cfg "a-and-contains" true [a, t],
    row iw2Cfg "b-and-contains" true [b, t],
    row iw2Cfg "contains" false [t],
    row iw2Cfg "order-a-desc" false [] [desc "a"],
    row iw2Cfg "order-b-asc" false [] [asc "b"],
    row iwdCfg "a-b-and-contains" true [a, b, t],
    row iwdCfg "a-b-and-contains-plan" true [a, b, t] (plan := some [ix iwd [("a", .desc), ("tags", .contains), ("__name__", .asc)], ix iwd [("b", .asc), ("__name__", .asc)]]),
    row iwdCfg "a-b-and-contains-name-desc" false [a, b, t] down,
    row iwdCfg "a-b-and-contains-name-desc-plan" false [a, b, t] down,
    row iwdCfg "a-and-contains" true [a, t],
    row iwdCfg "a-and-contains-name-desc" false [a, t] down,
    row iwdCfg "contains" false [t],
    row iwdCfg "order-a-desc" false [] [desc "a"],
    row io1Cfg "a-b-and-contains" true [a, b, t],
    row io1Cfg "a-b-and-contains-plan" true [a, b, t] (plan := some [ix io1 [("a", .asc), ("tags", .contains)], ix io1 [("b", .asc), ("__name__", .asc)]]),
    row io1Cfg "a-b-and-contains-name-desc" false [a, b, t] down,
    row io1Cfg "a-and-contains" true [a, t],
    row io1Cfg "contains" false [t],
    row io1Cfg "order-tags-asc" true [] [asc "tags"],
    row io1Cfg "order-a-desc" false [] [desc "a"],
    row ilwCfg "p7-query-stored-leap" true [eqF "t"],
    row ilwCfg "p7-query-stored-second-60" true [eqF "t"],
    row ig2Cfg "a-b-and-contains" true [a, b, t],
    row ig2Cfg "a-b-and-contains-plan" true [a, b, t] (plan := some [ix ig2 [("a", .asc), ("tags", .contains)], ix ig2 [("b", .asc), ("__name__", .asc)]]),
    row ig2Cfg "a-b-and-contains-name-desc" false [a, b, t] down,
    row ig2Cfg "a-and-contains" true [a, t],
    row ig2Cfg "contains" false [t],
    row ig2Cfg "group-contains" true [t] (group := true),
    row ig2Cfg "order-a-desc" false [] [desc "a"],
    row i2pCfg "a-b-c-and-contains" true [a, b, c, t],
    row i2pCfg "a-b-c-and-contains-plan" true [a, b, c, t] (plan := some [ix i2p [("a", .asc), ("b", .asc), ("tags", .contains)], ix i2p [("c", .asc), ("__name__", .asc)]]),
    row i2pCfg "a-b-c-and-contains-name-desc" false [a, b, c, t] down,
    row i2pCfg "a-b-and-contains" true [a, b, t],
    row i2pCfg "contains" false [t],
    row i2pCfg "order-a-desc" false [] [desc "a"],
    row i2pCfg "order-b-asc" false [] [asc "b"],
    row irvCfg "group-order-a-asc-name-desc" false [] [asc "a", desc "__name__"] (group := true),
    row irvCfg "group-order-a-asc-name-desc-plan" false [] [asc "a", desc "__name__"] (group := true),
    row irvCfg "order-a-asc-name-desc" true [] [asc "a", desc "__name__"],
    row irvCfg "group-a-name-desc" false [a] down (group := true),
    row irvCfg "a-name-desc" true [a] down,
    row icmCfg "a-and-contains-name-desc" true [a, t] down,
    row icmCfg "a-and-contains-name-desc-plan" true [a, t] down (plan := some [ix icm [("tags", .contains), ("__name__", .desc)], ix icm [("a", .asc), ("__name__", .desc)]]),
    row icmCfg "a-and-contains-name-asc" false [a, t] up,
    row icmCfg "a-name-desc" true [a] down,
    row icmCfg "contains-name-desc" true [t] down,
    row ig1Cfg "order-a-asc-name-desc" false [] [asc "a", desc "__name__"],
    row ig1Cfg "order-a-asc-name-desc-plan" false [] [asc "a", desc "__name__"],
    row ig1Cfg "group-order-a-asc-name-desc" true [] [asc "a", desc "__name__"] (group := true),
    row ig1Cfg "a-name-desc" false [a] down,
    row ig1Cfg "group-a-name-desc" true [a] down (group := true),
    row ip1Cfg "a-b-and-contains" true [a, b, t],
    row ip1Cfg "a-b-and-contains-plan" true [a, b, t] (plan := some [ix ip1 [("a", .desc), ("tags", .contains), ("__name__", .asc)], ix ip1 [("b", .asc), ("__name__", .asc)]]),
    row ip1Cfg "a-b-and-contains-name-desc" false [a, b, t] down,
    row ip1Cfg "a-b-and-contains-name-desc-plan" false [a, b, t] down,
    row ip1Cfg "a-and-contains" true [a, t],
    row ip1Cfg "a-and-contains-name-desc" false [a, t] down,
    row ip1Cfg "contains" false [t],
    row ip1Cfg "order-a-desc" false [] [desc "a"],
    row igxCfg "group-a-b-and-contains" true [a, b, t] (group := true),
    row igxCfg "group-a-b-and-contains-plan" true [a, b, t] (group := true) (plan := some [ix igx [("a", .asc), ("tags", .contains)] .group, ix igx [("b", .asc), ("__name__", .asc)] .group]),
    row igxCfg "group-a-b-and-contains-name-desc" false [a, b, t] down (group := true),
    row igxCfg "a-b-and-contains" true [a, b, t],
    row igxCfg "group-a-and-contains" true [a, t] (group := true),
    row igxCfg "group-contains" false [t] (group := true),
    row igxCfg "group-order-b-asc" true [] [asc "b"] (group := true),
    row igxCfg "order-b-asc" true [] [asc "b"],
    row igxCfg "group-order-a-desc" false [] [desc "a"] (group := true),
    row igyCfg "a-b-and-contains" true [a, b, t],
    row igyCfg "contains" false [t],
    row igyCfg "order-a-desc" false [] [desc "a"],
    row igyCfg "group-a-and-contains" true [a, t] (group := true),
    row is1Cfg "a-and-shared-path-name-asc" false [a, shared, t] up (source := .sharedArray),
    row is1Cfg "a-and-shared-path-name-desc" false [a, shared, t] down (source := .sharedArray),
    row is1Cfg "a-and-shared-path-name-asc-plan" false [a, shared, t] up (source := .sharedArray),
    row is1Cfg "a-and-shared-path-name-desc-plan" false [a, shared, t] down (source := .sharedArray),
    row is1Cfg "shared-path-name-asc" false [shared, t] up (source := .sharedArray),
    row is1Cfg "contains" true [t],
    row is1Cfg "order-tags-asc" false [] [asc "tags"],
    row is1Cfg "order-a-asc" true [] [asc "a"],
    row is1Cfg "order-a-desc" false [] [desc "a"],
    row is2Cfg "a-and-shared-path-name-asc" false [a, shared, t] up (source := .sharedArray),
    row is2Cfg "a-and-shared-path-name-desc" false [a, shared, t] down (source := .sharedArray),
    row is2Cfg "a-and-shared-path-name-asc-plan" false [a, shared, t] up (source := .sharedArray),
    row is2Cfg "a-and-shared-path-name-desc-plan" false [a, shared, t] down (source := .sharedArray),
    row is2Cfg "shared-path-name-asc" false [shared, t] up (source := .sharedArray),
    row is2Cfg "contains" true [t],
    row is2Cfg "order-tags-asc" false [] [asc "tags"],
    row is2Cfg "order-a-asc" false [] [asc "a"],
    row is2Cfg "order-a-desc" true [] [desc "a"]
  ]

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
    c.decision.served == served && c.productionIndexes.all (fun ms => c.decision == .merge ms) &&
      match c.productionPlan with
      | none => true
      | some plan => sameSet c.decision.planFields plan

/-- The rows the model contradicts; the build fails unless there are none. -/
def productionDisagreements : List String :=
  ((productionRows ++ obs2bRows).filter (!·.agreesWithProduction)).map (·.label)

#guard obs2bRows.length == 118
#guard productionDisagreements == []
#guard obs2P1Rows.length == 13
#guard obs2P1Rows.all Case.agreesWithProduction
#guard obs2MergeRows.length == 17
#guard obs2MergeRows.all fun c =>
  c.agreesWithProduction &&
    c.productionPlan.all (fun plan => c.decision.planFields == plan)

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
