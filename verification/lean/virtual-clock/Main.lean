import VirtualClock

/-!
# Golden trace generator

Prints traces of the specified clock. A trace starts with a header line

    trace <name> <new|paused|following> <start> <reading> <wall 0|1>

(`new` is `VirtualClock::new(start)`, `paused` adds `with_time_source`, `following` is
`following_with(start, source, reading)`; `wall 1` adds `with_wall_clock`). Each step is one line

    <reading> <wall instant> <op> [args] => <result> | <instant> <elapsed> <revision> <backwards> <following 0|1>

where `<reading>` is what the time source returns during the step and `<wall instant>` what the
wall clock returns. After the operation the replay reads `now()`, then `snapshot()` (instant,
elapsed, revision), `backwards_sets()` and `is_following()`; `now()` and the snapshot's instant
are both `<instant>` (the generator fails if the specification ever gives two different ones). A step whose operation panics is
`=> panic`, and one whose observation panics is `=> <result> | panic`; the trace ends there.

Operations: `freeze`, `resume`, `resumeAt <i> <allow>`, `resumeWall <allow>` (`read_wall` then
`resume_at_wall`), `advance <nanos>`, `advanceTo <i>`, `set <i>`, `setAllowBackwards <i>`,
`trySetAllowBackwards <i>`, `restrictRange <min> <max>`, `sync`, `tick`, `validateTarget <i>`,
`read`. Results: `unit`, `instant <i>`, `synced <0|1>`, `noWall`, `err <kind> [current requested]`.
-/

open VC

def b01 (b : Bool) : String := if b then "1" else "0"

def encOp : Op → String
  | .freeze => "freeze"
  | .resume => "resume"
  | .resumeAt i a => s!"resumeAt {i} {b01 a}"
  | .resumeWall a => s!"resumeWall {b01 a}"
  | .advance d => s!"advance {d}"
  | .advanceTo i => s!"advanceTo {i}"
  | .set i => s!"set {i}"
  | .setAllowBackwards i => s!"setAllowBackwards {i}"
  | .trySetAllowBackwards i => s!"trySetAllowBackwards {i}"
  | .restrictRange a b => s!"restrictRange {a} {b}"
  | .sync => "sync"
  | .tick => "tick"
  | .validateTarget i => s!"validateTarget {i}"
  | .read => "read"

def encErr : Err → String
  | .negativeDuration => "negativeDuration"
  | .overflow => "overflow"
  | .outOfRange => "outOfRange"
  | .noTimeSource => "noTimeSource"
  | .wouldMoveBackwards c q => s!"wouldMoveBackwards {c} {q}"

def encRes : Res → String
  | .unit => "unit"
  | .instant i => s!"instant {i}"
  | .synced b => s!"synced {b01 b}"
  | .noWall => "noWall"
  | .err e => s!"err {encErr e}"

def encObs (o : Obs) : String :=
  s!"{o.instant} {o.elapsed} {o.revision} {o.backwardsSets} {b01 o.following}"

/-- A trace being built: the state, the lines so far, and whether it ended in a panic. -/
structure B where
  st : St
  lines : Array String
  dead : Bool

def B.start (name : String) (init : Init) (wall : Bool) : B :=
  let head := match init with
    | .new t => s!"trace {name} new {t} 0 {b01 wall}"
    | .paused t => s!"trace {name} paused {t} 0 {b01 wall}"
    | .following t r => s!"trace {name} following {t} {r} {b01 wall}"
  ⟨init.state wall, #[head], false⟩

/-- Runs one step and the observation the replay makes after it. -/
def B.step (b : B) (r w : Int) (op : Op) : B :=
  if b.dead then b else
  let pre := s!"{r} {w} {encOp op} => "
  match VC.step b.st r w op with
  | none => { b with lines := b.lines.push (pre ++ "panic"), dead := true }
  | some (res, s1) =>
    match observe s1 r with
    | none => { b with lines := b.lines.push (pre ++ encRes res ++ " | panic"), dead := true }
    | some (o, s2) =>
      let obs := if o.now = o.instant then encObs o else s!"now {o.now} differs from {o.instant}"
      { b with st := s2, lines := b.lines.push (pre ++ encRes res ++ " | " ++ obs) }

/-- The instant a read at `r` shows now. -/
def B.live (b : B) (r : Int) : Int :=
  match sampleAt b.st r with
  | some (sm, _) => sm.instant
  | none => b.st.now

def B.range (b : B) : Option (Int × Int) := b.st.range

/-! ## The combinatorial traces

Every combination of the clock's mode, its position (range and `i128` edges), the relation of the
step's reading to the last one, and the operation with its target and backwards flag. -/

def base : Int := 1000000000
def r0 : Int := 1000

inductive Mode' | new | paused | following
  deriving DecidableEq

def Mode'.name : Mode' → String
  | .new => "new" | .paused => "paused" | .following => "following"

inductive Pos | free | inside | atMax | atMin | top | bottom
  deriving DecidableEq

def Pos.name : Pos → String
  | .free => "free" | .inside => "inside" | .atMax => "atMax" | .atMin => "atMin"
  | .top => "top" | .bottom => "bottom"

def Pos.start : Pos → Int
  | .top => i128Max - 4
  | .bottom => i128Min + 4
  | _ => base

inductive Rel | same | forward | back
  deriving DecidableEq

def Rel.name : Rel → String
  | .same => "same" | .forward => "forward" | .back => "back"

/-- The reading of the operation's step, after a history that read `r0 + 10`. -/
def Rel.reading : Rel → Int
  | .same => r0 + 10
  | .forward => r0 + 17
  | .back => r0 + 3

/-- The clock in a mode and position, with a read at `r0 + 10` behind it (a high-water mark of
10 for a following clock). -/
def setup (name : String) (m : Mode') (p : Pos) : B :=
  let init := match m with
    | .new => Init.new p.start
    | .paused => Init.paused p.start
    | .following => Init.following p.start r0
  let b := (B.start name init true).step (r0 + 10) 0 .read
  let l := b.live (r0 + 10)
  match p with
  | .inside => b.step (r0 + 10) 0 (.restrictRange (l - 1000) (l + 1000))
  | .atMax => b.step (r0 + 10) 0 (.restrictRange (l - 1000) l)
  | .atMin => b.step (r0 + 10) 0 (.restrictRange l (l + 1000))
  | _ => b

/-- Named targets relative to the instant now and the range. -/
def targets (b : B) (l : Int) : List (String × Int) :=
  let common := [("below", l - 1), ("equal", l), ("above", l + 1), ("i128min", i128Min),
    ("i128max", i128Max)]
  let ranged := match b.range with
    | some (mn, mx) => [("underMin", mn - 1), ("overMax", mx + 1)]
    | none => []
  (common ++ ranged).filter (fun (_, t) => fits t)

def targetOps (t : Int) : List (String × Op) :=
  [("resumeAt:0", .resumeAt t false), ("resumeAt:1", .resumeAt t true),
    ("advanceTo", .advanceTo t), ("setAllowBackwards", .setAllowBackwards t),
    ("trySetAllowBackwards", .trySetAllowBackwards t), ("validateTarget", .validateTarget t)]

/-- Operations without a target, and the wall resumes (the wall instant is the target). -/
def plainOps (l : Int) : List (String × Op × Int) :=
  [("freeze", .freeze, 0), ("resume", .resume, 0), ("sync", .sync, 0), ("tick", .tick, 0),
    ("read", .read, 0), ("advance:-1", .advance (-1), 0), ("advance:0", .advance 0, 0),
    ("advance:1", .advance 1, 0), ("advance:i128max", .advance i128Max, 0),
    ("set:below", .set (l - 1), 0), ("set:above", .set (l + 1), 0),
    ("restrictRange:around", .restrictRange (l - 5) (l + 5), 0),
    ("restrictRange:after", .restrictRange (l + 1) (l + 9), 0),
    ("restrictRange:before", .restrictRange (l - 9) (l - 1), 0)]

/-- `Op.Fits` as a test: every instant and duration of the operation is an `i128`. -/
def opFits (w : Int) : Op → Bool
  | .resumeAt i _ | .advanceTo i | .set i | .setAllowBackwards i | .trySetAllowBackwards i
  | .validateTarget i | .advance i => fits i
  | .resumeWall _ => fits w
  | .restrictRange a b => fits a && fits b
  | _ => true

def combinatorial : List B := Id.run do
  let mut out : Array B := #[]
  for m in [Mode'.new, .paused, .following] do
    for p in [Pos.free, .inside, .atMax, .atMin, .top, .bottom] do
      let rels := if m == .following then [Rel.same, .forward, .back] else [Rel.same]
      for rel in rels do
        let key := s!"{m.name}/{p.name}/{rel.name}"
        let pre := setup key m p
        let r := rel.reading
        let l := pre.live r
        let finish (name : String) (w : Int) (op : Op) : B :=
          let b := { pre with lines := pre.lines.set! 0 (pre.lines[0]!.replace key name) }
          (b.step r w op).step (r + 7) 0 .read
        for (n, op, w) in plainOps l do
          if opFits w op then
            out := out.push (finish s!"{key}/{n}" w op)
        for (tn, t) in targets pre l do
          for allow in [false, true] do
            out := out.push (finish s!"{key}/resumeWall:{b01 allow}/{tn}" t (.resumeWall allow))
          for (n, op) in targetOps t do
            out := out.push (finish s!"{key}/{n}/{tn}" 0 op)
  return out.toList

/-! ## Scenario traces -/

/-- A trace from a list of steps `(reading, wall instant, operation)`. -/
def run (name : String) (init : Init) (wall : Bool) (steps : List (Int × Int × Op)) : B :=
  steps.foldl (fun b (r, w, op) => b.step r w op) (B.start name init wall)

def scenarios : List B := [
  -- The elapsed budget: one move across the whole i128 range uses all of it.
  run "budget/exhaust" (.new i128Min) false [(0, 0, .advanceTo i128Max), (0, 0, .tick),
    (0, 0, .advance 0), (0, 0, .setAllowBackwards 0), (0, 0, .tick),
    (0, 0, .trySetAllowBackwards i128Min), (0, 0, .advanceTo (i128Min + 1))],
  -- A following clock with 1000 ns of budget left: the drift counts against a forward move,
  -- a sync folds it in, and a drift past the budget saturates instead of being refused.
  run "budget/drift-counts" (.paused i128Min) false [(0, 0, .advanceTo (i128Max - 1000)),
    (0, 0, .setAllowBackwards (i128Max - 3000)), (0, 0, .resume), (600, 0, .read),
    (600, 0, .advance 500), (600, 0, .advance 400), (600, 0, .sync), (600, 0, .advance 400),
    (600, 0, .tick), (1600, 0, .read), (1600, 0, .sync), (1600, 0, .advance 0)],
  run "budget/forward-exact" (.new i128Min) false [(0, 0, .advanceTo (i128Max - 1)), (0, 0, .tick),
    (0, 0, .tick)],
  -- Finding: a read steps back, uncounted, once the drift overflows i128.
  run "finding/i128-top-steps-back" (.following (i128Max - 10) 0) false [(5, 0, .read), (20, 0, .read)],
  run "finding/i128-top-steps-back-then-sync" (.following (i128Max - 10) 0) false
    [(5, 0, .read), (20, 0, .sync), (20, 0, .advance 0), (30, 0, .read)],
  -- Finding: a read below the range minimum, and a freeze in that state, which is refused
  -- because the instant it would publish is below the minimum.
  run "finding/read-below-range-min" (.following 10 0) false
    [(10, 0, .restrictRange 15 100), (i128Max, 0, .read)],
  run "finding/read-below-range-min-then-freeze" (.following 10 0) false
    [(10, 0, .restrictRange 15 100), (i128Max, 0, .freeze), (i128Max, 0, .sync)],
  -- Panics in unchecked i128 arithmetic.
  run "panic/reading-minus-anchor" (.following 0 i128Min) false [(i128Max, 0, .read)],
  run "panic/wall-anchor" (.following 0 i128Min) true
    [(i128Min + 100, 0, .read), (i128Min + 5, 7, .resumeWall true)],
  run "panic/publish-snapshot" (.following 0 0) false [(i128Max, 0, .read), (-10, 0, .sync)],
  -- Freeze and resume.
  run "mode/freeze-resume" (.following base 0) true [(30, 0, .read), (30, 0, .freeze),
    (90, 0, .read), (90, 0, .freeze), (120, 0, .resume), (120, 0, .resume), (125, 0, .read)],
  run "mode/freeze-at-the-step-back" (.following base 0) false
    [(30, 0, .read), (10, 0, .freeze), (40, 0, .resume), (45, 0, .read)],
  run "mode/no-source" (.new base) true [(0, 0, .resume), (0, 0, .resumeAt base true),
    (0, base, .resumeWall true), (0, 0, .freeze)],
  run "mode/no-wall" (.following base 0) false
    [(5, 0, .resumeWall false), (5, 0, .freeze), (9, 0, .resumeWall true)],
  -- Wall resumes: a clock already at the wall instant is accepted; a wall that stepped back
  -- needs allowBackwards, is counted, and the clock then follows the wall.
  run "wall/at-the-wall" (.following base 0) true [(40, base + 40, .resumeWall false),
    (70, 0, .read), (70, base + 70, .resumeWall false), (80, 0, .read)],
  run "wall/stepped-back" (.following base 0) true [(40, 0, .read),
    (30, base + 30, .resumeWall false), (30, base + 30, .resumeWall true), (35, 0, .read),
    (36, 0, .sync)],
  run "wall/frozen-sync" (.paused base) true [(500, base + 9000, .resumeWall false),
    (510, 0, .read), (400, base + 10, .resumeWall true)],
  -- Ranges: nesting, empty intersection, and the edges of LogicalInstant.
  run "range/nested" (.new 50) false [(0, 0, .restrictRange 0 100), (0, 0, .restrictRange 40 200),
    (0, 0, .restrictRange 200 300), (0, 0, .advanceTo 101), (0, 0, .trySetAllowBackwards 39)],
  run "range/edges" (.new 0) false [(0, 0, .restrictRange i128Min i128Max),
    (0, 0, .setAllowBackwards i128Min), (0, 0, .advance i128Max), (0, 0, .tick)],
  run "range/following-clamps" (.following 0 0) false
    [(0, 0, .restrictRange 0 10), (25, 0, .read), (25, 0, .sync)],
  -- LogicalInstant edges without a range.
  run "edge/max" (.new i128Max) false [(0, 0, .tick), (0, 0, .advance 0), (0, 0, .advance (-1))],
  run "edge/min" (.new i128Min) false [(0, 0, .setAllowBackwards i128Min),
    (0, 0, .resumeAt i128Min false), (0, 0, .advanceTo i128Min)]
]

/-! ## Pseudo-random traces -/

/-- A linear congruential generator (Knuth's MMIX constants), so the corpus is reproducible. -/
def lcg (x : Nat) : Nat := (x * 6364136223846793005 + 1442695040888963407) % 2 ^ 64

def pick (seed : Nat) (n : Nat) : Nat := (seed / 65536) % n

def randomOp (seed : Nat) (l : Int) : Op :=
  let k := pick seed 14
  let d : Int := Int.ofNat (pick (lcg seed) 40) - 10
  match k with
  | 0 => .freeze | 1 => .resume | 2 => .resumeAt (l + d) (pick seed 2 == 0)
  | 3 => .resumeWall (pick seed 3 == 0) | 4 => .advance d | 5 => .advanceTo (l + d)
  | 6 => .set (l + d) | 7 => .setAllowBackwards (l + d) | 8 => .trySetAllowBackwards (l + d)
  | 9 => .restrictRange (l - 20 + d) (l + 30 + d) | 10 => .sync | 11 => .tick
  | 12 => .validateTarget (l + d) | _ => .read

def randomTrace (i : Nat) : B := Id.run do
  let mut seed := lcg (i + 1)
  let init := match pick seed 3 with
    | 0 => Init.new base | 1 => Init.paused base | _ => Init.following base 0
  let mut b := B.start s!"random/{i}" init true
  let mut r : Int := 0
  for _ in [0:16] do
    seed := lcg seed
    -- Readings mostly move forward, sometimes stand still or step back.
    r := r + Int.ofNat (pick seed 30) - 8
    seed := lcg seed
    let l := b.live r
    let w := l + Int.ofNat (pick seed 20) - 10
    seed := lcg seed
    b := b.step r w (randomOp seed l)
  return b

def random : List B := (List.range 120).map randomTrace

def main : IO UInt32 := do
  let traces := combinatorial ++ scenarios ++ random
  -- Every input of a step (reading, wall instant, arguments) must be an i128.
  if !(traces.all (fun b => b.lines.all (fun l =>
      ((l.splitOn " => ").head!.splitOn " ").all (fun tok => (tok.toInt?.map fits).getD true)))) then
    IO.eprintln "a step has an input outside i128"
    return 1
  let steps := traces.foldl (fun n b => n + b.lines.size - 1) 0
  if traces.any (fun b => b.lines.any (fun l => (l.splitOn "differs from").length > 1)) then
    IO.eprintln "now() and snapshot() disagree in the specification"
    return 1
  IO.println "# Generated by verification/lean/virtual-clock (lake exe corpus). Do not edit."
  IO.println s!"# {traces.length} traces, {steps} steps. Format: see Main.lean."
  for b in traces do
    for line in b.lines do
      IO.println line
  return 0
