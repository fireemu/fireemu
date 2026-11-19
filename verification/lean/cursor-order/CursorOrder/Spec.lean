import CursorOrder.Value

namespace CO

/-- Fields are numbered in BTreeSet order. Zero denotes the distinguished name field. -/
abbrev Clause := Nat × Bool
abbrev Order := List Clause
abbrev Path := List (List Nat)

/-- A field map after successful lookup of all ordered fields. True means descending. -/
structure Row where
  name : Path
  field : Nat → FVO.Val

def project (d : Row) (f : Nat) : FVO.Val :=
  if f = 0 then .reference d.name else d.field f

def directed (desc : Bool) (v : Ordering) := if desc then v.swap else v

/-- The sign is the first non-tie in the directed projections, or equality if none exists. -/
def lexSpec (o : Order) (a b : Row) : Ordering :=
  ((o.map fun (f, desc) => directed desc (FVO.cmp (project a f) (project b f))).find?
    (· != .eq)).getD .eq

/-- A well-formed effective order ends in the inherited name clause and uses each field once. -/
def EffectiveSpec (e o : Order) : Prop :=
  (o.map Prod.fst).Nodup ∧ ∃ init, o = init ++ [(0, (e.getLast?.map Prod.snd).getD false)]

/-- A start includes larger keys and an end includes smaller keys. On the boundary, startAt and endAt include the tie. -/
def BoundSpec (start before : Bool) (sign : Ordering) : Prop :=
  (if start then sign = .gt else sign = .lt) ∨ (sign = .eq ∧ before = start)

/-- The explicit prefix is preserved. The middle is the subsequence of the sorted inequality set containing exactly the absent non-name fields. Every appended clause inherits the last explicit direction (default ascending). -/
def LayoutSpec (explicit : Order) (inequalities : List Nat) (out : Order) : Prop :=
  let fields := explicit.map Prod.fst
  let desc := (explicit.getLast?.map Prod.snd).getD false
  ∃ middle : List Nat, middle.Sublist inequalities ∧
    (∀ f, f ∈ middle ↔ f ∈ inequalities ∧ f ≠ 0 ∧ f ∉ fields) ∧
    out = explicit ++ middle.map (fun f => (f, desc)) ++ (if 0 ∈ fields then [] else [(0, desc)])

end CO
