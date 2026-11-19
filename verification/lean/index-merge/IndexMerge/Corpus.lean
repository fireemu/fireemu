import IndexMerge.Model

/-!
# Corpus cases: configurations, names and the text format

A case is a query, an index configuration (composites in insertion order, collection-group
default overrides and per-field overrides, as `IndexSet::set_default_single_field_indexes` and
`IndexSet::set_single_field_indexes` set them), a planning context, and optionally the verdict
production recorded for it. The format is described in `Main.lean`.
-/

namespace IM

/-- An index configuration as the corpus states it. -/
structure Config where
  composites : List Index := []
  /-- `(collection group, modes)`: the unquoted `*` override. -/
  defaults : List (Nat × List (Scope × Mode)) := []
  /-- `(collection group, field, modes)`: a literal field override. -/
  overrides : List (Nat × Field × List (Scope × Mode)) := []
  deriving Repr

/-- The modes `IndexSet::single_field_modes` returns without any override. -/
def builtinModes : List (Scope × Mode) :=
  [(.collection, .asc), (.collection, .desc), (.collection, .contains)]

def Config.modes (c : Config) (coll : Nat) (f : Field) : List (Scope × Mode) :=
  match c.overrides.find? (fun o => o.1 == coll && o.2.1 == f) with
  | some o => o.2.2
  | none =>
    match c.defaults.find? (fun d => d.1 == coll) with
    | some d => d.2
    | none => builtinModes

def Config.toISet (c : Config) : ISet := ⟨c.composites, c.modes⟩

structure Case where
  label : String
  query : Query
  config : Config
  policy : Policy := .production
  edition : Edition := .standard
  /-- Production's verdict (served or refused for a missing index) and the recorded row. -/
  production : Option (Bool × String) := none
  /-- The members production's plan named, without `__name__` fields, when recorded. -/
  productionPlan : Option (List (List IField)) := none

def Case.decision (c : Case) : Decision :=
  decideQuery c.query c.config.toISet c.policy c.edition

/-! ## Names -/

def insertString (x : String) : List String → List String
  | [] => [x]
  | y :: ys => if y < x then y :: insertString x ys else if y == x then y :: ys else x :: y :: ys

def sortStrings (l : List String) : List String := l.foldr insertString []

/-- Every field name the corpus uses, `__name__` first and the rest in `FieldPath` order, so
that a field's number is its position and numeric order is `FieldPath` order. -/
def fieldNames : List String :=
  "__name__" :: sortStrings ([
      "a", "b", "c", "d", "e", "f", "s", "tags", "nx", "n", "category", "city",
      "editors_pick", "star_rating", "p"] ++ (List.range 100).map (fun i => s!"e{i}"))

def fid (name : String) : Field := fieldNames.idxOf name

def fname (f : Field) : String := fieldNames.getD f s!"unknown{f}"

def collNames : List String :=
  ["qx", "other", "pk", "ord", "mrg", "qcg", "items", "qg", "ql"]

def cid (name : String) : Nat := collNames.idxOf name

def cname (c : Nat) : String := collNames.getD c s!"unknown{c}"

/-! ## Rendering -/

def Mode.tag : Mode → String
  | .asc => "asc"
  | .desc => "desc"
  | .contains => "contains"
  | .vector d => s!"vector{d}"

def Dir.tag : Dir → String
  | .asc => "asc"
  | .desc => "desc"

def Scope.tag : Scope → String
  | .collection => "C"
  | .group => "G"

def renderIndex (i : Index) : String :=
  s!"{cname i.coll} {i.scope.tag} " ++
    ",".intercalate (i.fields.map fun f => s!"{fname f.path}:{f.mode.tag}")

def renderModes (ms : List (Scope × Mode)) : String :=
  if ms.isEmpty then "-" else ",".intercalate (ms.map fun m => s!"{m.1.tag}:{m.2.tag}")

def Filter.render : Filter → String
  | .eq f => s!"filter eq {fname f}"
  | .isNull f => s!"filter isnull {fname f}"
  | .contains f => s!"filter contains {fname f}"
  | .gt f => s!"filter gt {fname f}"

def Policy.tag : Policy → String
  | .production => "production"
  | .report => "report"
  | .emulator => "emulator"

def Edition.tag : Edition → String
  | .standard => "standard"
  | .enterprise => "enterprise"

def Decision.render : Decision → String
  | .use i => s!"expect use {renderIndex i}"
  | .merge ms => "expect merge " ++ " ; ".intercalate (ms.map renderIndex)
  | .missing i => s!"expect missing {renderIndex i}"
  | .assumed i => s!"expect assumed {renderIndex i}"
  | .fullScan i => s!"expect fullscan {renderIndex i}"

def Case.render (c : Case) (n : Nat) : List String :=
  [s!"case {n} {c.label}",
   s!"query {cname c.query.coll} {if c.query.group then "G" else "C"}",
   s!"ctx {c.policy.tag} {c.edition.tag}"]
  ++ c.query.filters.map Filter.render
  ++ c.query.orderBy.map (fun o => s!"order {fname o.path} {o.dir.tag}")
  ++ c.config.defaults.map (fun d => s!"default {cname d.1} {renderModes d.2}")
  ++ c.config.overrides.map (fun o => s!"override {cname o.1} {fname o.2.1} {renderModes o.2.2}")
  ++ c.config.composites.map (fun i => s!"composite {renderIndex i}")
  ++ (match c.production with
      | some (served, row) => [s!"production {if served then "served" else "refused"} {row}"]
      | none => [])
  ++ [c.decision.render, "end"]

/-! ## Construction helpers -/

def ix (coll : Nat) (fields : List (String × Mode)) (scope : Scope := .collection) : Index :=
  ⟨coll, scope, fields.map fun f => ⟨fid f.1, f.2⟩⟩

def asc (name : String) : OrderC := ⟨fid name, .asc⟩
def desc (name : String) : OrderC := ⟨fid name, .desc⟩

def query (coll : Nat) (filters : List Filter) (orderBy : List OrderC := [])
    (group : Bool := false) : Query :=
  ⟨coll, group, filters, orderBy⟩

def eqF (name : String) : Filter := .eq (fid name)
def gtF (name : String) : Filter := .gt (fid name)
def hasF (name : String) : Filter := .contains (fid name)

end IM
