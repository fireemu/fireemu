import CursorOrder.Spec

namespace CO

def effective (e : Order) (inequalities : List Nat) : Order := Id.run do
  let desc := (e.getLast?.map Prod.snd).getD false
  let fields := e.map Prod.fst
  let extra := inequalities.filter (fun f => f != 0 && !fields.contains f)
  return e ++ extra.map (fun f => (f, desc)) ++ (if fields.contains 0 then [] else [(0, desc)])

/-- Order-specific canonicalization checks, in refusal order. The inequalities are the sorted distinct output of inequality_fields. -/
inductive Refusal | duplicate | afterName | arity deriving DecidableEq

def check (prod : Bool) (e : Order) (ineq : List Nat) (arity : Nat) : Option Refusal := Id.run do
  let o := effective e ineq
  if prod && !(e.map Prod.fst).Nodup then return some .duplicate
  if (o.dropWhile (fun c => c.1 != 0)).length > 1 then return some .afterName
  if arity > (if prod then e.length else o.length) then return some .arity
  return none

inductive Slot
  | stored (v : FVO.Val)
  | name (p : Path)

def Slot.value : Slot → FVO.Val
  | .stored v => v
  | .name p => .reference p

def Slot.against : Slot → FVO.Val → Ordering
  | .stored a, b => FVO.cmp a b
  | .name p, .reference q => FVO.lex FVO.cmpBytes p q
  | .name _, b => FVO.cmpNat 7 b.rank

def Slot.pair : Slot → Slot → Ordering
  | .stored a, .stored b => FVO.cmp a b
  | .name p, .name q => FVO.lex FVO.cmpBytes p q
  | .name _, .stored b => FVO.cmpNat 7 b.rank
  | .stored a, .name _ => FVO.cmpNat a.rank 7

def slot (d : Row) (f : Nat) : Slot := if f = 0 then .name d.name else .stored (d.field f)

def key (d : Row) (o : Order) := o.map fun c => slot d c.1

/-- Both store loops zip the two slices and the order, stopping at the shortest. -/
def scan (cmp : α → β → Ordering) : Order → List α → List β → Ordering
  | (_, desc) :: os, a :: as, b :: bs => (directed desc (cmp a b)).then (scan cmp os as bs)
  | _, _, _ => .eq

abbrev compareKeys := scan Slot.pair
abbrev compareCursor := scan Slot.against

def bound (start before : Bool) (ord : Ordering) : Bool :=
  match ord with
  | .eq => if start then before else !before
  | .gt => start
  | .lt => !start

abbrev Cursor := List FVO.Val × Bool

def admits (o : Order) (k : List Slot) (s e : Option Cursor) :=
  (s.all fun c => bound true c.2 (compareCursor o k c.1)) &&
  (e.all fun c => bound false c.2 (compareCursor o k c.1))

structure Document where
  name : Path
  field : Nat → Option FVO.Val

def orderKey (d : Document) (o : Order) : Option (List Slot) :=
  o.mapM fun c => if c.1 = 0 then some (.name d.name) else (d.field c.1).map Slot.stored

/-- Lookup at the requested version, scope and filter evaluation are inputs. Filter errors propagate. -/
def cursorAfterDocument (doc : Option Document) (inScope : Bool) (matchesFilter : Except Unit Bool)
    (o : Order) (s e : Option Cursor) : Except Unit (Option Cursor) := do
  let some d := doc | return none
  unless inScope do return none
  unless ← matchesFilter do return none
  let some k := orderKey d o | return none
  unless admits o k s e do return none
  return some (k.map Slot.value, false)

end CO
