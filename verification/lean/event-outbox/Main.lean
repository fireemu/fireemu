import EventOutbox

open EventOutbox

def retentions : List Nat := [0, 1, 2, 4]
def layouts : List String := ["shared", "split", "default"]
def orders : List String := ["tied", "reordered"]
def traces : List String := ["dispatch", "retry", "eviction"]

def textList {α : Type} (showItem : α → String) (xs : List α) : String :=
  if xs.isEmpty then "-" else String.intercalate "," (xs.map showItem)

def queueName (q : String) : String := if q.isEmpty then "default" else q

def phaseName : Phase → String
  | .pending => "pending"
  | .leased => "leased"
  | .running => "running"
  | .waiting due => s!"wait:{due}"
  | .terminal => "terminal"

def key (e : Entry) : String := s!"{e.time}:{e.id}"
def afterHead (s : State) (q : String) : Option String := do
  let head ← (s.queue q).head?
  let tail := (s.successor q head.key).map key |>.getD "-"
  some s!"{queueName q}:{key head}:{tail}"

def snapshot (s : State) : String :=
  let heads := ["", "alpha", "beta"].filterMap (afterHead s)
  let due := [0, 2, 3, 4].map fun now => textList toString (s.due now)
  let entries := [1, 2, 3, 4].map fun id => (s.lookup id |>.map (fun e => phaseName e.phase)).getD "-"
  String.intercalate "|" [toString s.entries.length, toString s.active, toString s.evictions,
    textList (fun e => toString e.id) s.pending, textList id heads,
    String.intercalate "/" due, String.intercalate "," entries]

def describe : Operation → String
  | .enqueue e => s!"enqueue,{e.id},{e.time},{queueName e.queue}"
  | .lease id => s!"lease,{id}"
  | .run id => s!"run,{id}"
  | .wait id now => s!"wait,{id},{now}"
  | .release id now => s!"release,{id},{now}"
  | .interrupt id => s!"interrupt,{id}"
  | .retire id => s!"retire,{id}"

def entry (layout order : String) (id : Nat) : Entry :=
  let time := if order = "tied" then 2 else if id = 3 then 0 else if id = 2 then 1 else 3
  let queue :=
    if layout = "shared" then "alpha"
    else if id = 1 then (if layout = "default" then "" else "beta")
    else "alpha"
  ⟨id, time, queue, .pending⟩

def program (layout order trace : String) : List Operation :=
  ([3, 1, 2].map (fun id => .enqueue (entry layout order id))) ++
  if trace = "retry" then
    [.lease 3, .run 3, .wait 3 1, .lease 2, .run 2, .wait 2 2, .lease 1, .run 1, .wait 1 2,
     .release 1 2, .release 1 3, .lease 1, .run 1, .interrupt 1,
     .retire 2, .retire 3, .release 2 4]
  else if trace = "eviction" then
    [.retire 2, .retire 1, .retire 1, .retire 3, .enqueue (entry layout order 2),
     .lease 2, .retire 2, .enqueue (entry layout order 4)]
  else
    [.enqueue (entry layout order 2), .lease 4, .lease 3, .run 3, .interrupt 3,
     .lease 2, .run 2, .retire 2, .enqueue (entry layout order 2)]

def run : List Operation → State → List String
  | [], _ => []
  | op :: rest, state =>
    let (next, result) := step state op
    s!"{describe op}#{result}#{snapshot next}" :: run rest next

def main : IO Unit := do
  IO.println s!"# {retentions.length * layouts.length * orders.length * traces.length} cases."
  for retention in retentions do
    for layout in layouts do
      for order in orders do
        for trace in traces do
          let replay := String.intercalate ";" (run (program layout order trace) {retention})
          IO.println (String.intercalate "\t" [toString retention, layout, order, trace, replay])
