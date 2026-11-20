import RtdbQueryWindow
open RtdbQueryWindow

def keys : Array String := #["", "1", "01", "2", "10", "a", "z", "𐀀", ""]

def ranks (order : String) : List ValueRank :=
  match order with
  | "key"      => List.replicate 8 (0, 0)
  | "value"    => [(3, 2), (3, 2), (3, 1), (1, 0), (2, 0), (4, 0), (5, 0), (5, 0)]
  | "priority" => [(3, 2), (3, 2), (0, 0), (0, 0), (3, 1), (4, 0), (3, 3), (0, 0)]
  | _          => [(0, 0), (0, 0), (0, 0), (0, 0), (0, 0), (0, 0), (3, 2), (3, 2)]

def middle (order : String) : ValueRank := if order == "key" then (0, 0) else (3, 2)

def rangeFor (order bounds : String) : Option Bound × Option Bound :=
  let target := middle order
  let loKey := if order == "key" then 2 else 0
  let openLoKey := if order == "key" then 2 else 9
  let hiKey := if order == "key" then 2 else 9
  let openHiKey := if order == "key" then 2 else 0
  match bounds with
  | "lowerClosed" => (some ⟨(target, loKey), true⟩, none)
  | "lowerOpen" => (some ⟨(target, openLoKey), false⟩, none)
  | "upperClosed" => (none, some ⟨(target, hiKey), true⟩)
  | "upperOpen" => (none, some ⟨(target, openHiKey), false⟩)
  | "namedSpan" => if order == "key" then (some ⟨(target, 2), true⟩, some ⟨(target, 5), false⟩)
                  else (some ⟨(target, 2), true⟩, some ⟨(target, 7), false⟩)
  | "equal" => (some ⟨(target, loKey), true⟩, some ⟨(target, hiKey), true⟩)
  | "reverse" => if order == "key" then (some ⟨(target, 5), true⟩, some ⟨(target, 2), true⟩)
                 else (some ⟨((3, 3), 0), true⟩, some ⟨(target, 9), true⟩)
  | _ => (none, none)

def limitOf (name : String) : Limit :=
  match name with
  | "firstZero" => .first 0
  | "firstTwo" => .first 2
  | "lastTwo" => .last 2
  | "lastAll" => .last 20
  | _ => .all

def main : IO Unit := do
  for order in ["key", "value", "priority", "child"] do
    let rows : List Row := (ranks order).zipIdx.map (fun (index, i) => ⟨i + 1, index⟩)
    for bounds in ["none", "lowerClosed", "lowerOpen", "upperClosed", "upperOpen", "namedSpan", "equal", "reverse"] do
      let (lo, hi) := rangeFor order bounds
      for cap in ["none", "firstZero", "firstTwo", "lastTwo", "lastAll"] do
        let names := (window rows lo hi (limitOf cap)).map (fun r => keys[r.keyRank]!)
        IO.println <| "\t".intercalate [order, bounds, cap, if names.isEmpty then "-" else ",".intercalate names]
