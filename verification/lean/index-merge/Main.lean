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
  ix qx [("e", .asc), ("a", .asc)]]

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
    ("contains", { composites := [pool[4]!, pool[11]!, pool[3]!] }),
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

def main : IO Unit := do
  let all := productionRows ++ productCases ++ randomCases 3000
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
