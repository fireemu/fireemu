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
    filter <eq|isnull|contains|gt> <field>   -- any number, in order
    order <field> <asc|desc>                 -- any number, in order
    production <served|refused> <row>        -- optional: the recorded production verdict
    expect <use|missing|assumed|fullscan> <index>
    expect merge <index> ; <index> ; ...
    end

Field `__name__` in a filter is a filter on the document name (the replay gives it a reference
value); every other filter value is an integer. The expected decision is `IM.decideQuery`.
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

def main : IO Unit := do
  let all := productionRows ++ pictRows.map pictCase ++ productCases ++ randomCases 3000
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
    for f in c.query.filters do IO.println f.render
    for o in c.query.orderBy do IO.println s!"order {fname o.path} {o.dir.tag}"
    match c.production with
    | some (served, row) => IO.println s!"production {if served then "served" else "refused"} {row}"
    | none => pure ()
    IO.println c.decision.render
    IO.println "end"
