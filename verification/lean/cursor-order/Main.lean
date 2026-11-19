import CursorOrder.Theorems

/-! One pipe-separated case per line: explicit order | inequality fields | effective order | bound (SA, SX, EA, EX for start/end inclusive/exclusive) | cursor values | production refusal | emulator refusal | ordered results. Lists use commas; an empty list is empty text. A clause is its field number followed by + or -. Results are semicolon-separated relative paths, each followed by = and the exclusive cursor returned for that document. A rejected emulator query has result !. The group is items, with fixtures defined by documents below. Reference values include the entire resource name. -/

open CO

def resource (path : String) : Path :=
  (("projects/demo-app/databases/(default)/documents/" ++ path).splitOn "/").map
    fun s => s.toUTF8.data.toList.map UInt8.toNat

def integer (n : Int) : FVO.Val := .num (.fin (n * 2^1074))

def fixture (p : String) (a : Option FVO.Val) (b c : Int) : String × Document :=
  (p, ⟨resource p, fun | 1 => a | 2 => some (integer b) | 3 => some (integer c) | _ => none⟩)

def documents := [
  fixture "p/a/items/z" (some (integer 2)) 1 1,
  fixture "p/a!/items/z" (some (integer 2)) 1 1,
  fixture "items/a" (some (.string [120])) 0 1,
  fixture "items/b" none 0 2,
  fixture "items/c" (some .null) (-1) 0,
  fixture "items/d" (some (integer 2)) 2 0]

def encodeVal : FVO.Val → String
  | .null => "null"
  | .string [120] => "x"
  | .num (.fin z) => toString (z / 2^1074)
  | .reference p => "@" ++ String.intercalate "/" (p.map fun s => String.ofList (s.map Char.ofNat))
  | _ => panic! "value outside the fixture"

def values (vs : List FVO.Val) := String.intercalate "," (vs.map encodeVal)

def clauses (o : Order) := String.intercalate "," (o.map fun (f,b) => toString f ++ if b then "-" else "+")

def refusal : Option Refusal → String
  | none => "ok"
  | some .duplicate => "duplicate"
  | some .afterName => "afterName"
  | some .arity => "arity"

def casesFor (e : Order) (ineq : List Nat) : List String := Id.run do
  let o := effective e ineq
  let mut lines := []
  for pivot in [(fixture "p/a/items/z" (some (integer 2)) 1 1).2, (fixture "p/a/items/zz" (some (integer 3)) 1 1).2] do
    let some k := orderKey pivot o | panic! "pivot missing an ordered field"
    for n in List.range (k.length + 2) do
      let vs := ((k.map Slot.value) ++ [FVO.Val.null]).take n
      for (tag,start,before) in [("SA",true,true),("SX",true,false),("EA",false,false),("EX",false,true)] do
        let s := if start then some (vs,before) else none
        let t := if start then none else some (vs,before)
        let accepted := documents.filterMap fun (p,d) => Id.run do
          let passes := ineq.all fun f => ((d.field f).map fun v => FVO.cmp v (integer (-1)) == .gt).getD false
          let .ok (some (cs,false)) := cursorAfterDocument (some d) true (.ok passes) o s t | return none
          return some (d.row, p ++ "=" ++ values cs)
        let sorted := accepted.mergeSort fun a b => lexSpec o a.1 b.1 != .gt
        let emu := check false e ineq n
        lines := String.intercalate "|" [clauses e, String.intercalate "," (ineq.map toString), clauses o,
          tag, values vs, refusal (check true e ineq n), refusal emu,
          if emu.isSome then "!" else String.intercalate ";" (sorted.map Prod.snd)] :: lines
  return lines.reverse

def main : IO Unit := do
  let mut orders : List Order := [[]]
  for d in [false,true] do
    orders := orders ++ [[(0,d)],[(1,d)],[(1,d),(0,!d)],[(1,d),(2,!d)],
      [(1,d),(2,!d),(3,d)],[(1,d),(2,!d),(0,d)],[(1,d),(1,!d)],[(0,d),(1,!d)],[(0,d),(0,!d)]]
  let lines := orders.flatMap fun o => [[],[2],[2,3]].flatMap (casesFor o)
  IO.println s!"# {lines.length} cases."
  for line in lines do IO.println line
