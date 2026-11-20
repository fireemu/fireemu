import PubSubRestNegativeCache

open PubSubRestNegativeCache

inductive Op where
  | observe (key : Key) (method : Method) (time : Int) (result : Outcome)
  | probe (key : Key) (method : Method) (time : Int)
  | forget (conn : Nat)
  | fill

def labelMethod : Method → String
  | .get => "get" | .patch => "patch" | .delete => "delete" | .other => "other"

def labelOutcome : Outcome → String
  | .ok => "ok" | .missing => "missing" | .other => "other"

def ttl : Int := 10350000000

def cases (method : Method) : List (String × List Op) :=
  let arm := fun atTime => Op.observe 0 method atTime .missing
  [("edge", [arm 0, .probe 0 .get 0, .probe 0 .delete (ttl - 1),
      .probe 0 .get ttl, .probe 0 .patch 0]),
   ("scope", [arm 0, .probe 10000 .get 1, .probe 4999 .get 1, .probe 1 .get 1,
      .probe 0 .get 1, .forget 1, .probe 0 .get 1, .forget 0, .probe 0 .get 1]),
   ("debounce", [.observe 0 .get 0 .ok, arm 1, .probe 0 .get 1, arm ttl,
      .probe 0 .get ttl]),
   ("hits", [arm 0, .probe 0 .other 1, .probe 0 .get 2, .observe 0 .other 3 .ok,
      arm 4, .probe 0 .patch (ttl - 1), .probe 0 .get ttl]),
   ("rewind", [arm 3, .probe 0 .get 2, arm 1, .probe 0 .patch 3,
      .probe 0 .get (ttl + 2), .probe 0 .get (ttl + 3)]),
   ("prune", [arm 0, .observe 1 .patch 1 .missing, .observe 2 .other ttl .other,
      .probe 0 .get ttl, .probe 1 .get ttl, .probe 1 .get (ttl + 1)])]

def extra : List (String × List Op) :=
  [("capacity-tie", [.fill, .observe 4096 .get 0 .missing, .probe 0 .get 0,
      .probe 4096 .get 0]),
   ("capacity-newer", [.fill, .observe 4096 .get 1 .missing, .probe 0 .get 1,
      .probe 1 .get 1, .probe 4096 .get 1]),
   ("capacity-prune", [.fill, .observe 4096 .get ttl .missing, .probe 0 .get ttl,
      .probe 4096 .get ttl])]

def emit (fields : List String) := IO.println (String.intercalate "\t" fields)

def run (fields : List String) (rules : Rules) (ops : List Op) : IO Unit := do
  emit (["trace"] ++ fields ++ [toString rules.ttl])
  let mut cache : Cache := {}
  for op in ops do
    let row ← match op with
      | .observe key method time result =>
        cache := observe rules cache key method time result
        pure ["observe", toString key, labelMethod method, toString time, labelOutcome result]
      | .probe key method time =>
        let (serve, next) := probe rules cache key method time
        cache := next
        pure ["probe", toString key, labelMethod method, toString time, if serve then "hit" else "miss"]
      | .forget conn =>
        cache := forget cache conn
        pure ["forget", toString conn]
      | .fill =>
        cache := { armed := (List.range rules.capacity).map (·, 0) }
        pure ["fill"]
    emit (row ++ [toString cache.armed.length])

def main : IO Unit := do
  let methods : List Method := [.get, .patch, .delete, .other]
  let count := methods.foldl (fun n method =>
    n + (cases method).foldl (fun acc (_, ops) => acc + 1 + ops.length) 0) 0
  let bulk := extra.foldl (fun n (_, ops) => n + 1 + ops.length) 0
  IO.println s!"# {2 * count + bulk}"
  for exempts in [true, false] do
    for method in methods do
      for (label, ops) in cases method do
        run [if exempts then "on" else "off", labelMethod method, label] ⟨ttl, exempts, 4096⟩ ops
  for (label, ops) in extra do
    run ["on", "get", label] ⟨ttl, true, 4096⟩ ops
