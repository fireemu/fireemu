import IndexMerge
import Std.Data.HashMap

/-!
# Golden corpus generator

Prints the index configurations first, then the cases. A configuration is

    config <k>
    default <collection> <modes>             -- the collection group's unquoted `*` override
    override <collection> <field> <modes>    -- a literal field override
    composite <index>                        -- in the order they are added
    endconfig

where `<modes>` is `-` (none) or a comma list of `<C|G>:<asc|desc|contains>`, and an index is
`<collection> <C|G> <field>:<mode>,...`. A case is

    case <n> <label>
    uses <k>
    query <collection> <C|G>
    ctx <production|report|emulator> <standard|enterprise>
    source <in1|or2|count|sharedArray>                  -- optional provenance of a projected equality
    filter <eq|isnull|contains|containsany|gt> <field>   -- any number, in order
    order <field> <asc|desc>                 -- any number, in order
    production <served|refused> <row>        -- optional: the recorded production verdict
    expect <use|missing|assumed|fullscan> <index>
    expect merge <index> ; <index> ; ...
    base <use|missing|assumed|fullscan> <index>
    base merge <index> ; <index> ; ...
    guard <none|a|b|c|reverse|shared|carrier|groupOrdered|arrayFirst>
    end

Field `__name__` in a filter is a filter on the document name (the replay gives it a reference
value); every other filter value is an integer. The expected decision is the head answer
`IM.decideHead`; `base` is the base answer `IM.decideBase` and `guard` the override that fires
(`IM.guardOf`: `none` when the head answer is the base answer).
-/

open IM

/-! ## Configurations -/

instance : Inhabited Index := ⟨⟨0, .collection, []⟩⟩

def other := cid "other"

def pool : List Index := [
  ix qx [("a", .asc), ("b", .asc)],
  ix qx [("a", .asc), ("e", .asc)],
  ix qx [("b", .asc), ("e", .asc)],
  ix qx [("c", .asc), ("e", .desc)],
  ix qx [("a", .asc), ("tags", .contains)],
  ix qx [("a", .asc), ("b", .asc), ("e", .asc)],
  ix qx [("b", .asc), ("a", .asc), ("__name__", .desc)],
  ix qx [("a", .asc), ("e", .asc), ("__name__", .desc)],
  ix qx [("a", .asc), ("b", .asc)] .group,
  ix other [("a", .asc), ("b", .asc)],
  ix qx [("a", .desc), ("b", .asc)],
  ix qx [("tags", .contains), ("e", .asc)],
  ix qx [("c", .asc), ("__name__", .desc)],
  ix qx [("b", .asc), ("c", .asc)],
  ix qx [("c", .desc), ("e", .asc)],
  ix qx [("e", .asc), ("a", .asc)],
  ix qx [("a", .asc), ("b", .contains)]]

def allModes : List (Scope × Mode) :=
  [(.collection, .asc), (.collection, .desc), (.collection, .contains),
   (.group, .asc), (.group, .desc), (.group, .contains)]

/-- Single-field configurations: builtin; `a` exempt; `a` ascending only; every field exempt
(the wildcard); `tags` without its contains index; collection-group indexes for every field;
`b` descending only; `e` collection-group ascending only. -/
def modeConfigs : List (List (Nat × List (Scope × Mode)) × List (Nat × Field × List (Scope × Mode))) := [
  ([], []),
  ([], [(qx, fid "a", [])]),
  ([], [(qx, fid "a", [(.collection, .asc)])]),
  ([(qx, [])], []),
  ([], [(qx, fid "tags", [(.collection, .asc), (.collection, .desc)])]),
  ([(qx, allModes)], []),
  ([], [(qx, fid "b", [(.collection, .desc)])]),
  ([], [(qx, fid "e", [(.group, .asc)])])]

/-! ## Query shapes -/

def eqSets : List (List String) :=
  [[], ["a"], ["b"], ["c"], ["a", "b"], ["a", "c"], ["b", "c"], ["a", "b", "c"]]

/-- Order shapes: the extra filters and the explicit orders. -/
def orderShapes : List (List Filter × List OrderC) := [
  ([], []),
  ([], [asc "__name__"]),
  ([], [desc "__name__"]),
  ([], [asc "e"]),
  ([], [desc "e"]),
  ([], [asc "e", desc "__name__"]),
  ([gtF "e"], []),
  ([gtF "e"], [desc "e"]),
  ([gtF "__name__"], []),
  ([gtF "__name__"], [desc "__name__"]),
  ([], [asc "a"]),
  ([], [desc "b", asc "__name__"])]

def mkQuery (eqs : List String) (nullFirst contains group : Bool)
    (shape : List Filter × List OrderC) : Query :=
  let eqFilters := eqs.zipIdx.map fun (n, i) => if nullFirst && i == 0 then .isNull (fid n) else eqF n
  query qx (eqFilters ++ (if contains then [hasF "tags"] else []) ++ shape.1) shape.2 group

/-! ## Deterministic pseudo-random choices -/

def lcg (x : Nat) : Nat := (x * 6364136223846793005 + 1442695040888963407) % 18446744073709551616

/-- A stream of draws below `n`. -/
def draws (seed : Nat) (k : Nat) : List Nat :=
  (List.range k).foldl (fun (acc : List Nat × Nat) _ =>
    let s := lcg acc.2
    (acc.1 ++ [s / 4294967296], s)) ([], seed) |>.1

structure Gen where
  configs : Array Config := #[]
  ids : Std.HashMap String Nat := {}
  cases : Array (Nat × Case) := #[]

def Gen.configId (g : Gen) (c : Config) : Gen × Nat :=
  let key := toString (repr c)
  match g.ids.get? key with
  | some i => (g, i)
  | none =>
    ({ g with configs := g.configs.push c, ids := g.ids.insert key g.configs.size },
      g.configs.size)

def Gen.add (g : Gen) (c : Case) : Gen :=
  let (g, k) := g.configId c.config
  { g with cases := g.cases.push (k, c) }

/-- The product of every query shape with a few configurations. -/
def productCases : List Case := Id.run do
  let configs : List (String × Config) := [
    ("none", {}),
    ("pairs", { composites := [pool[0]!, pool[1]!, pool[2]!, pool[13]!] }),
    ("contains", { composites := [pool[4]!, pool[11]!, pool[3]!, pool[16]!] }),
    ("names", { composites := [pool[6]!, pool[7]!, pool[12]!] }),
    ("exempt-a", { composites := [pool[1]!, pool[2]!], overrides := (modeConfigs[1]!).2 }),
    ("wildcard", { composites := [pool[0]!, pool[5]!], defaults := (modeConfigs[3]!).1 })]
  let mut out := []
  for (cn, config) in configs do
    for eqs in eqSets do
      for contains in [false, true] do
        for (shape, si) in orderShapes.zipIdx do
          for group in [false, true] do
            out := out ++ [{ label := s!"product/{cn}/eq{eqs.length}{"".intercalate eqs}/{if contains then "tags" else "-"}/shape{si}/{if group then "G" else "C"}"
                             query := mkQuery eqs false contains group shape
                             config := config }]
  return out

/-- Random configurations and queries. -/
def randomCases (n : Nat) : List Case :=
  (List.range n).map fun i =>
    let d := draws (i + 1) 24
    let pick (k m : Nat) : Nat := d[k]! % m
    let composites := (pool.zipIdx.filter fun (_, j) => pick (j % 16) 1000 + j * 7 % 13 < 220).map (·.1)
    let modes := modeConfigs[pick 16 modeConfigs.length]!
    let eqs := eqSets[pick 17 eqSets.length]!
    let shape := orderShapes[pick 18 orderShapes.length]!
    let contains := pick 19 3 == 0
    let group := pick 20 4 == 0
    let nullFirst := pick 21 5 == 0
    let ctx := pick 22 10
    let (policy, edition) : Policy × Edition :=
      if ctx < 6 then (.production, .standard) else if ctx == 6 then (.report, .standard)
      else if ctx == 7 then (.emulator, .standard) else if ctx == 8 then (.production, .enterprise)
      else (.emulator, .enterprise)
    -- Reverse the composite order for a quarter of the cases.
    let composites := if pick 23 4 == 0 then composites.reverse else composites
    { label := s!"random/{i}"
      query := mkQuery eqs nullFirst contains group shape
      config := { composites, defaults := modes.1, overrides := modes.2 }
      policy, edition }

/-! ## Pairwise rows

The rows PICT generated (`/r:7`, with the required rows of the coverage ledger as seeds) for
the axes `Eq Contains Order Composites Modes Group Ctx CompositeOrder NullFirst`. -/

def pictRows : List String := [
  "2 no none none builtin C prodStd forward no",
  "2 no fieldAsc pairs builtin C prodStd forward no",
  "3 no none pairs builtin C prodStd forward no",
  "1 yes none none builtin C prodStd forward no",
  "1 yes nameDesc none builtin C prodStd forward no",
  "2 no nameDesc none aAscOnly C prodStd forward no",
  "2 no eqOrdered none builtin C prodStd forward no",
  "2 no none none exemptA C prodStd forward no",
  "0 no nameDesc none builtin C prodStd forward no",
  "1 yes none contains exemptA C prodStd forward no",
  "2 no fieldAsc pairs builtin C prodStd reversed no",
  "2 no none none builtin G prodStd forward no",
  "2 no none none groupAll G prodStd forward no",
  "2 no none none builtin C emuStd forward no",
  "2 no fieldAsc none builtin C reportStd forward no",
  "2 no fieldAsc none builtin C prodEnt forward no",
  "2 no none none wildcard C prodStd forward no",
  "0 no nameRange none wildcard C prodStd forward no",
  "0 yes rangeDesc names aAscOnly G emuEnt reversed yes",
  "3 yes eqOrdered mixed wildcard G emuStd reversed yes",
  "1 no fieldNameDesc contains tagsNoContains G reportStd forward yes",
  "1 yes nameDesc pairs eGroupAsc G prodEnt reversed yes",
  "2 yes descThenName mixed aAscOnly C reportStd reversed yes",
  "3 no nameDesc names wildcard C emuEnt forward no",
  "0 no descThenName contains builtin G emuEnt forward yes",
  "0 no nameAsc mixed eGroupAsc C emuStd forward no",
  "3 yes fieldAsc none eGroupAsc G emuEnt reversed yes",
  "0 yes eqOrdered contains bDescOnly C prodEnt reversed yes",
  "1 yes range names exemptA G emuStd reversed yes",
  "2 no fieldNameDesc pairs bDescOnly G emuEnt forward no",
  "3 yes nameRange names builtin G reportStd reversed yes",
  "1 yes eqOrdered pairs tagsNoContains C emuEnt reversed no",
  "3 yes fieldAsc contains aAscOnly C emuStd forward yes",
  "1 yes fieldNameDesc mixed wildcard C prodEnt reversed yes",
  "2 no none names aAscOnly C prodEnt reversed yes",
  "3 no descThenName names eGroupAsc C prodStd reversed no",
  "0 yes fieldAsc mixed tagsNoContains G prodStd reversed yes",
  "0 yes nameAsc pairs builtin G reportStd reversed yes",
  "3 no rangeDesc mixed builtin C prodEnt forward no",
  "1 yes descThenName pairs groupAll C emuStd reversed yes",
  "1 no fieldDesc mixed builtin C emuEnt reversed yes",
  "2 yes nameRangeDesc contains groupAll C prodEnt forward no",
  "3 no nameRange mixed groupAll C emuEnt forward yes",
  "3 yes descThenName none bDescOnly G prodEnt forward yes",
  "1 no rangeDesc none groupAll C reportStd reversed no",
  "1 no nameRangeDesc names bDescOnly G prodStd reversed yes",
  "3 yes fieldNameDesc pairs exemptA G prodEnt reversed no",
  "2 yes fieldDesc contains eGroupAsc G reportStd forward no",
  "0 yes none mixed eGroupAsc C reportStd reversed yes",
  "1 no fieldAsc names bDescOnly C reportStd forward no",
  "2 no range pairs builtin C emuEnt forward no",
  "1 yes nameRange contains eGroupAsc C emuStd reversed yes",
  "0 yes nameAsc names exemptA G emuEnt reversed yes",
  "0 yes eqOrdered names groupAll C reportStd forward no",
  "3 yes nameAsc contains groupAll C prodStd reversed no",
  "0 yes fieldDesc pairs aAscOnly G prodEnt reversed yes",
  "1 no nameAsc none aAscOnly C prodEnt forward no",
  "3 yes range mixed groupAll G reportStd forward no",
  "2 yes rangeDesc pairs exemptA G emuStd forward yes",
  "3 no fieldDesc contains wildcard C emuStd reversed no",
  "2 yes rangeDesc contains tagsNoContains G emuStd reversed yes",
  "0 no range contains aAscOnly G prodEnt reversed no",
  "3 no descThenName none tagsNoContains G prodEnt forward yes",
  "0 yes rangeDesc mixed bDescOnly C emuStd reversed no",
  "1 yes fieldDesc names tagsNoContains G prodStd reversed yes",
  "1 yes range none tagsNoContains C prodStd reversed no",
  "2 yes nameRange pairs bDescOnly G prodEnt forward yes",
  "0 yes nameRangeDesc pairs tagsNoContains G emuEnt reversed no",
  "3 no nameDesc mixed exemptA C reportStd reversed yes",
  "3 yes eqOrdered pairs eGroupAsc G emuEnt forward no",
  "0 yes range pairs wildcard G reportStd forward yes",
  "2 no fieldDesc none groupAll C prodEnt reversed yes",
  "0 no fieldDesc contains bDescOnly C prodStd forward no",
  "1 yes range none bDescOnly C emuStd forward yes",
  "0 yes fieldAsc mixed wildcard G emuEnt reversed yes",
  "3 no nameRangeDesc none builtin G reportStd forward no",
  "2 yes nameRange mixed aAscOnly G prodEnt forward no",
  "2 yes nameRangeDesc mixed aAscOnly G emuStd forward no",
  "0 no nameRange names exemptA G prodStd forward yes",
  "2 no nameAsc names tagsNoContains C prodEnt forward yes",
  "2 no rangeDesc names eGroupAsc G prodStd forward no",
  "1 yes none names tagsNoContains C emuEnt forward yes",
  "0 no fieldNameDesc names eGroupAsc C prodStd reversed no",
  "2 yes nameDesc contains groupAll G emuStd reversed yes",
  "0 yes fieldAsc names exemptA G prodStd forward no",
  "0 yes rangeDesc pairs wildcard G emuEnt forward no",
  "1 no fieldNameDesc none builtin G emuStd reversed no",
  "2 yes eqOrdered mixed aAscOnly G prodStd reversed yes",
  "3 no nameAsc pairs bDescOnly G prodStd forward yes",
  "0 yes nameRange none tagsNoContains G prodStd forward no",
  "3 no eqOrdered contains exemptA G prodEnt reversed yes",
  "1 no descThenName mixed wildcard G emuEnt reversed yes",
  "2 yes fieldDesc names exemptA C prodEnt forward yes",
  "2 no nameRangeDesc pairs eGroupAsc G prodStd reversed yes",
  "1 no range none eGroupAsc C emuStd reversed yes",
  "0 no none names bDescOnly C reportStd reversed no",
  "0 yes fieldAsc none groupAll G emuEnt forward yes",
  "0 no fieldNameDesc names aAscOnly G reportStd reversed yes",
  "2 no descThenName contains exemptA C reportStd forward no",
  "1 yes nameDesc pairs bDescOnly C emuStd forward no",
  "1 yes nameRangeDesc none exemptA G prodStd forward yes",
  "0 no nameAsc pairs wildcard G prodEnt forward no",
  "1 no nameDesc contains tagsNoContains C emuStd reversed no",
  "2 no fieldNameDesc none groupAll C prodEnt forward yes",
  "0 yes nameRangeDesc pairs wildcard C prodEnt forward yes"
]

def pictComposites : String → List Index
  | "pairs" => [pool[0]!, pool[1]!, pool[2]!, pool[13]!]
  | "contains" => [pool[4]!, pool[11]!, pool[3]!, pool[16]!]
  | "names" => [pool[6]!, pool[7]!, pool[12]!]
  | "mixed" => [pool[0]!, pool[4]!, pool[6]!, pool[1]!, pool[10]!, pool[14]!, pool[15]!, pool[8]!,
      pool[9]!]
  | _ => []

def orderNames : List String := ["none", "nameAsc", "nameDesc", "fieldAsc", "fieldDesc",
  "fieldNameDesc", "range", "rangeDesc", "nameRange", "nameRangeDesc", "eqOrdered", "descThenName"]

def modeNames : List String := ["builtin", "exemptA", "aAscOnly", "wildcard", "tagsNoContains",
  "groupAll", "bDescOnly", "eGroupAsc"]

instance : Inhabited Case := ⟨{ label := "", query := query qx [], config := {} }⟩

def pictCase (row : String) : Case :=
  match row.splitOn " " with
  | [eq, contains, order, composites, modes, group, ctx, compositeOrder, nullFirst] =>
    let eqs := [[], ["a"], ["a", "b"], ["a", "b", "c"]][eq.toNat!]!
    let shape := orderShapes[orderNames.idxOf order]!
    let ms := modeConfigs[modeNames.idxOf modes]!
    let cs := pictComposites composites
    let (policy, edition) : Policy × Edition := match ctx with
      | "reportStd" => (.report, .standard)
      | "emuStd" => (.emulator, .standard)
      | "prodEnt" => (.production, .enterprise)
      | "emuEnt" => (.emulator, .enterprise)
      | _ => (.production, .standard)
    { label := s!"pict/{"/".intercalate (row.splitOn " ")}"
      query := mkQuery eqs (nullFirst == "yes") (contains == "yes") (group == "G") shape
      config := { composites := if compositeOrder == "reversed" then cs.reverse else cs,
                  defaults := ms.1, overrides := ms.2 }
      policy, edition }
  | _ => panic! s!"bad PICT row {row}"

/-! ## The head's guards and their neighbours

Shapes that reach each override of `IM.decideHead` and the neighbours where it must not fire. -/

def shapeCase (label : String) (q : Query) (config : Config) (policy : Policy := .production)
    (edition : Edition := .standard) : Case :=
  { label := s!"shape/{label}", query := q, config, policy, edition }

def containsAnyF (name : String) : Filter := .containsAny (fid name)
def isNullF (name : String) : Filter := .isNull (fid name)

def aAscOnly : List (Nat × Field × List (Scope × Mode)) := [(qx, fid "a", [(.collection, .asc)])]
def f1Config (composites : List Index) : Config :=
  { composites, overrides := [(qx, fid "a", []), (qx, fid "tags", [])] }
def aTagsC : Index := ix qx [("a", .asc), ("tags", .contains)]

def shapeCases : List Case :=
  let dirs : List (String × OrderC) := [("asc", asc "__name__"), ("desc", desc "__name__")]
  let f1q := query qx [eqF "a", eqF "b", hasF "tags"]
  let f3q := query qx [eqF "a", hasF "tags"] [desc "__name__"]
  -- An equality and an array-contains on the same path.
  (dirs.flatMap fun (dn, o) =>
    [shapeCase s!"shared-path/builtin/{dn}" (query qx [eqF "a", eqF "tags", hasF "tags"] [o]) {},
     shapeCase s!"shared-path/a-asc-tags-contains/{dn}"
       (query qx [eqF "a", eqF "tags", hasF "tags"] [o])
       { overrides := [(qx, fid "a", [(.collection, .asc)]),
           (qx, fid "tags", [(.collection, .contains)])] }])
  ++ [
    -- IS NULL fails the shape.
    shapeCase "isnull-and-eq/builtin" (query qx [isNullF "a", eqF "b"]) {},
    shapeCase "isnull-and-eq/a-asc-only/desc" (query qx [isNullF "a", eqF "b"] [desc "__name__"])
      { overrides := aAscOnly },
    shapeCase "isnull-alone/a-asc-only/desc" (query qx [isNullF "a"] [desc "__name__"])
      { overrides := aAscOnly },
    -- A filter on `__name__` fails the shape: (c) does not fire.
    shapeCase "name-eq-and-eq/a-asc-only/desc" (query qx [eqF "__name__", eqF "a"] [desc "__name__"])
      { overrides := aAscOnly },
    shapeCase "single-eq/a-asc-only/desc" (query qx [eqF "a"] [desc "__name__"])
      { overrides := aAscOnly },
    shapeCase "single-eq/a-asc-only/desc/report" (query qx [eqF "a"] [desc "__name__"])
      { overrides := aAscOnly } .report,
    shapeCase "single-eq/a-asc-only/desc/emulator" (query qx [eqF "a"] [desc "__name__"])
      { overrides := aAscOnly } .emulator,
    shapeCase "single-eq/a-asc-only/desc/enterprise" (query qx [eqF "a"] [desc "__name__"])
      { overrides := aAscOnly } .production .enterprise,
    shapeCase "single-eq/a-asc-only/desc/group" (query qx [eqF "a"] [desc "__name__"] true)
      { overrides := [(qx, fid "a", [(.group, .asc)])] },
    shapeCase "single-eq/a-asc-only/order-a-desc" (query qx [eqF "a"] [desc "a"])
      { overrides := aAscOnly },
    -- The serving-composite neighbour of (c).
    shapeCase "single-eq/a-asc-only/desc/serving-composite" (query qx [eqF "a"] [desc "__name__"])
      { composites := [ix qx [("a", .desc), ("__name__", .desc)]], overrides := aAscOnly },
    -- array-contains-any fails the shape.
    shapeCase "contains-any/f1-set" (query qx [eqF "a", eqF "b", containsAnyF "tags"])
      (f1Config [aTagsC]),
    shapeCase "contains-any/builtin/desc" (query qx [eqF "a", containsAnyF "tags"] [desc "__name__"])
      {},
    -- (b) with a non-carrying composite, with two carrying ones, and with a remaining field
    -- that lacks its ascending index.
    shapeCase "b/non-carrying-and-carrying" f1q
      (f1Config [ix qx [("a", .asc), ("b", .asc)], aTagsC]),
    -- Two carrying composites: (b) needs exactly one, so the base answer stays.
    shapeCase "b/two-carrying" (query qx [eqF "a", eqF "b", eqF "c", hasF "tags"])
      (f1Config [aTagsC, ix qx [("a", .asc), ("c", .asc), ("tags", .contains)]]),
    shapeCase "b/two-carrying-f1" f1q
      (f1Config [aTagsC, ix qx [("a", .asc), ("b", .asc), ("tags", .contains)]]),
    shapeCase "b/two-carrying-disjoint" f1q
      (f1Config [aTagsC, ix qx [("b", .asc), ("tags", .contains)]]),
    -- An available automatic contains index does not disable (b).
    shapeCase "b/automatic-contains-available" f1q
      { composites := [aTagsC], overrides := [(qx, fid "a", [])] },
    -- An explicit name suffix changes the recorded merge7 composite.
    shapeCase "b/descending-carrier" f1q
      (f1Config [ix qx [("a", .desc), ("tags", .contains), ("__name__", .asc)]]),
    shapeCase "b/carrier-name-asc" f1q
      (f1Config [ix qx [("a", .asc), ("tags", .contains), ("__name__", .asc)]]),
    shapeCase "b/carrier-name-desc" f1q
      (f1Config [ix qx [("a", .asc), ("tags", .contains), ("__name__", .desc)]]),
    -- Merge7 and merge8 enabled the other equality at both scopes.
    shapeCase "b/group-carrier" f1q
      (f1Config [ix qx [("a", .asc), ("tags", .contains)] .group]),
    shapeCase "b/remaining-desc-only" f1q
      { composites := [aTagsC],
        overrides := [(qx, fid "a", []), (qx, fid "tags", []), (qx, fid "b", [(.collection, .desc)])] },
    shapeCase "b/three-equalities" (query qx [eqF "a", eqF "b", eqF "c", hasF "tags"])
      (f1Config [aTagsC]),
    -- (a) with an exempt equality field and a configured `(a ASC, __name__ DESC)`.
    shapeCase "a/exempt-equality-with-composite" f3q
      { composites := [ix qx [("a", .asc), ("__name__", .desc)]],
        overrides := [(qx, fid "a", [])] },
    shapeCase "a/three-equalities" (query qx [eqF "a", eqF "b", eqF "c", hasF "tags"] [desc "__name__"]) {},
    -- F1 and F3 outside the gate.
    shapeCase "f1/enterprise" f1q (f1Config [aTagsC]) .production .enterprise,
    shapeCase "f3/enterprise" f3q {} .production .enterprise,
    shapeCase "f1/report" f1q (f1Config [aTagsC]) .report,
    shapeCase "f3/report" f3q {} .report,
    shapeCase "f1/emulator" f1q (f1Config [aTagsC]) .emulator,
    shapeCase "f3/emulator" f3q {} .emulator,
    shapeCase "f1/group" (query qx [eqF "a", eqF "b", hasF "tags"] [] true)
      { composites := [ix qx [("a", .asc), ("tags", .contains)] .group],
        overrides := [(qx, fid "a", []), (qx, fid "tags", []), (qx, fid "b", [(.group, .asc)])] },
    shapeCase "f3/group" (query qx [eqF "a", hasF "tags"] [desc "__name__"] true)
      { overrides := [(qx, fid "a", [(.group, .desc)]), (qx, fid "tags", [(.group, .contains)])] }]

def carrierBoundaryCases : List Case :=
  let q := query qx [eqF "a", eqF "b", hasF "tags"]
  let bCarrier := ix qx [("b", .asc), ("tags", .contains)]
  let descCarrier := ix qx [("a", .desc), ("tags", .contains), ("__name__", .asc)]
  let wrongNameCarrier := ix qx [("a", .asc), ("tags", .contains), ("__name__", .desc)]
  let groupCarrier := ix qx [("a", .asc), ("tags", .contains)] .group
  let otherCarrier := ix other [("a", .desc), ("tags", .contains), ("__name__", .asc)]
  [shapeCase "b/automatic-plan-with-two-carriers" q { composites := [aTagsC, bCarrier] },
   shapeCase "b/automatic-plan-with-descending-carrier" q { composites := [descCarrier] },
   shapeCase "b/automatic-plan-with-group-carrier" q { composites := [groupCarrier] },
   shapeCase "b/automatic-plan-with-wrong-name-carrier" q { composites := [wrongNameCarrier] },
   shapeCase "b/automatic-plan-with-mixed-carriers" q { composites := [aTagsC, descCarrier] },
   shapeCase "b/unserved-with-mixed-carriers" q (f1Config [aTagsC, descCarrier]),
   shapeCase "b/automatic-plan-with-other-collection-carrier" q { composites := [otherCarrier] }]

/-- Unrecorded neighbors of the merge7 and merge8 catalogs. -/
def reviewBoundaryCases : List Case :=
  let q := query qx [eqF "a", eqF "b", hasF "tags"]
  let carrier := ix qx [("a", .asc), ("tags", .contains)] .group
  let b := (qx, fid "b", [(Scope.collection, Mode.asc), (.group, .asc)])
  let exemptions := [(qx, fid "a", []), (qx, fid "tags", []), b]
  [shapeCase "b/group-with-descending-alternative" { q with group := true }
     { composites := [carrier, ix qx [("a", .desc), ("tags", .contains)] .group], overrides := [b] },
   shapeCase "b/group-carrier-with-builtin-equality" q
     { composites := [carrier], overrides := [b, (qx, fid "tags", [])] },
   { shapeCase "shared-path/builtin-equality-tags-contains"
       (query qx [eqF "a", eqF "tags", hasF "tags"] [asc "__name__"])
       { overrides := [(qx, fid "tags", [(.collection, .contains)])] } with source := .sharedArray },
   shapeCase "b/group-with-equality-enabled-at-group-scope" { q with group := true }
     { composites := [carrier], overrides := [(qx, fid "a", [(.group, .asc)]), (qx, fid "tags", []), b] },
   shapeCase "b/group-carrier-with-extra-collection-carrier" q
     { composites := [carrier, ix qx [("b", .asc), ("tags", .contains)]], overrides := exemptions }]

#guard reviewBoundaryCases.all fun c =>
  c.guard == .none && c.decision == c.baseDecision &&
    (c.source == .sharedArray || c.decision == .missing (requiredIndex (reqOf c.query) c.query.coll c.query.group))

def main : IO Unit := do
  let all := productionRows ++ pictRows.map pictCase ++ productCases ++ shapeCases ++
    randomCases 3000 ++ obs2P1Rows ++ obs2MergeRows ++ carrierBoundaryCases ++ obs2bRows ++ reviewBoundaryCases
  let g := all.foldl Gen.add {}
  IO.println "# Golden corpus of the Lean index-merge model (verification/lean/index-merge)."
  IO.println "# Generated by `lake exe corpus`; do not edit. The format is in Main.lean."
  for (c, k) in g.configs.toList.zip (List.range g.configs.size) do
    IO.println s!"config {k}"
    for d in c.defaults do IO.println s!"default {cname d.1} {renderModes d.2}"
    for o in c.overrides do IO.println s!"override {cname o.1} {fname o.2.1} {renderModes o.2.2}"
    for i in c.composites do IO.println s!"composite {renderIndex i}"
    IO.println "endconfig"
  for ((k, c), n) in g.cases.toList.zip (List.range g.cases.size) do
    IO.println s!"case {n} {c.label}"
    IO.println s!"uses {k}"
    IO.println s!"query {cname c.query.coll} {if c.query.group then "G" else "C"}"
    IO.println s!"ctx {c.policy.tag} {c.edition.tag}"
    match c.source with
    | .plain => pure ()
    | .inOne => IO.println "source in1"
    | .orTwo => IO.println "source or2"
    | .count => IO.println "source count"
    | .sharedArray => IO.println "source sharedArray"
    for f in c.query.filters do IO.println f.render
    for o in c.query.orderBy do IO.println s!"order {fname o.path} {o.dir.tag}"
    match c.production with
    | some (served, row) => IO.println s!"production {if served then "served" else "refused"} {row}"
    | none => pure ()
    IO.println c.decision.render
    IO.println (c.baseDecision.renderAs "base")
    IO.println s!"guard {c.guard.tag}"
    IO.println "end"
