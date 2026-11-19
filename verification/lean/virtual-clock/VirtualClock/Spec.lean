/-!
# The virtual clock as a state machine

A specification of `VirtualClock` in `crates/fireemu-core-session/src/clock.rs`. Integers are
unbounded here; every place where the Rust code saturates, checks or clamps is written out, and
every place where it uses unchecked `i128` arithmetic is a `none` result: a panic in a build with
overflow checks (the `dev` and `test` profiles), a wrapped value otherwise.

Each step takes the reading `r` of the clock's `TimeSource` and the wall instant `w` that its
`WallSource` returns. Within one step every call of the source returns `r` and every call of the
wall clock returns `w`; the Rust replay test injects sources that do exactly that.

The time source of a following clock is the anchor `at` (the reading at the last move) and the
high-water mark `peak` (the most drift any read reported since). Every read of a following clock
updates `peak`, also a read that refuses an operation: `peak` lives in a `Cell` in Rust.
-/

namespace VC

def i128Min : Int := -170141183460469231731687303715884105728
def i128Max : Int := 170141183460469231731687303715884105727
def u128Max : Int := 340282366920938463463374607431768211455
def u64Max : Int := 18446744073709551615
def u32Max : Int := 4294967295

/-- Whether an `i128` operation with this exact result is representable. -/
def fits (x : Int) : Bool := decide (i128Min ≤ x ∧ x ≤ i128Max)

/-- `i128::saturating_sub` and friends: the exact result clamped to the `i128` range. -/
def sat128 (x : Int) : Int := max i128Min (min i128Max x)

/-- `u128::saturating_add`, `u64::saturating_add`, `u32::saturating_add` on non-negative values. -/
def satU128 (x : Int) : Int := min u128Max x
def satU64 (x : Int) : Int := min u64Max x
def satU32 (x : Int) : Int := min u32Max x

/-- Where the clock takes its time from. -/
inductive Mode where
  /-- Frozen, with no time source (`VirtualClock::new`): it can never resume. -/
  | noSource
  /-- Frozen, with a time source kept for a resume (`paused` in Rust). -/
  | frozen
  /-- Following real time: the anchor reading and the high-water mark of the drift. -/
  | following (anchor peak : Int)
  deriving DecidableEq, Repr

structure St where
  now : Int
  mode : Mode
  /-- Whether the clock has a wall clock (`with_wall_clock`). -/
  wall : Bool
  backwardsSets : Int
  elapsed : Int
  revision : Int
  range : Option (Int × Int)
  deriving DecidableEq, Repr

def St.following (s : St) : Bool :=
  match s.mode with
  | .following _ _ => true
  | _ => false

inductive Err where
  | negativeDuration
  | overflow
  | outOfRange
  | noTimeSource
  | wouldMoveBackwards (current requested : Int)
  deriving DecidableEq, Repr

/-- What an operation returns. -/
inductive Res where
  | unit
  | instant (i : Int)
  | synced (published : Bool)
  /-- `read_wall` gave no reading (no wall clock or no time source), so nothing was resumed. -/
  | noWall
  | err (e : Err)
  deriving DecidableEq, Repr

inductive Op where
  | freeze
  | resume
  | resumeAt (instant : Int) (allowBackwards : Bool)
  /-- `read_wall` followed by `resume_at_wall` with that reading. -/
  | resumeWall (allowBackwards : Bool)
  | advance (nanos : Int)
  | advanceTo (instant : Int)
  | set (instant : Int)
  | setAllowBackwards (instant : Int)
  | trySetAllowBackwards (instant : Int)
  | restrictRange (minimum maximum : Int)
  | sync
  | tick
  | validateTarget (instant : Int)
  /-- `now()` on its own. -/
  | read
  deriving DecidableEq, Repr

/-- One sample of the running time (`Sample` in Rust). -/
structure Sample where
  instant : Int
  drift : Int
  counted : Int
  deriving DecidableEq, Repr

def clampMax : Option (Int × Int) → Int → Int
  | some (_, mx), x => min x mx
  | none, x => x

/-- `sample_at`: the drift since the last move (held at the high-water mark), the instant it
gives, cut at the range maximum, and the forward movement it counts. `none` when
`reading - anchor` overflows `i128`. The returned state records the new high-water mark. -/
def sampleAt (s : St) (r : Int) : Option (Sample × St) :=
  let mk (drift : Int) (mode : Mode) : Sample × St :=
    let i0 := if drift = 0 then s.now else if fits (s.now + drift) then s.now + drift else s.now
    let instant := clampMax s.range i0
    (⟨instant, drift, max 0 (sat128 (instant - s.now))⟩, { s with mode := mode })
  match s.mode with
  | .following a p =>
    if fits (r - a) then
      let drift := max (r - a) p
      some (mk drift (.following a drift))
    else none
  | m => some (mk 0 m)

/-- `check`: the publication budget, then the range. -/
def check (s : St) (instant : Int) (sm : Sample) : Option Err :=
  if s.revision = u64Max ∨
      (instant > sm.instant ∧ satU128 (s.elapsed + sm.counted) + (instant - sm.instant) > u128Max)
  then some .overflow
  else match s.range with
    | some (mn, mx) => if instant < mn ∨ instant > mx then some .outOfRange else none
    | none => none

/-- `publish`: fold the sample's counted time and the forward move into the elapsed budget,
move the anchor past the folded drift, count the revision, and take the snapshot the observers
get (one more read of the source). -/
def publish (s : St) (instant : Int) (sm : Sample) (r : Int) : Option St :=
  let e1 := satU128 (s.elapsed + sm.counted)
  let e2 := if instant > sm.instant then satU128 (e1 + (instant - sm.instant)) else e1
  let mode? : Option Mode :=
    match s.mode with
    | .following a _ => if fits (a + sm.drift) then some (.following (a + sm.drift) 0) else none
    | m => some m
  match mode? with
  | none => none
  | some m =>
    let s' := { s with now := instant, elapsed := e2, mode := m, revision := satU64 (s.revision + 1) }
    (sampleAt s' r).map (·.2)

/-- The state a resume publishes from: a frozen clock starts to follow from the reading `r`, a
rewind is counted, and a resume at a wall reading anchors at that reading less the drift the
publication folds in. `none` when `reading - drift` overflows `i128`. -/
def resumeState (s1 : St) (sm : Sample) (instant : Int) (wallReading : Option Int) (r : Int) :
    Option St :=
  let s2 := match s1.mode with
    | .following _ _ => s1
    | _ => { s1 with mode := .following r 0 }
  let s3 := if instant < sm.instant then
    { s2 with backwardsSets := satU32 (s2.backwardsSets + 1) } else s2
  match wallReading, s3.mode with
  | some rr, .following _ p =>
    if fits (rr - sm.drift) then some { s3 with mode := .following (rr - sm.drift) p } else none
  | _, _ => some s3

/-- `resume_to`: `wallReading` is the reading of a `resume_at_wall`. -/
def resumeTo (s : St) (instant : Int) (allow : Bool) (wallReading : Option Int) (r : Int) :
    Option (Res × St) :=
  match s.mode with
  | .noSource => some (.err .noTimeSource, s)
  | _ =>
    match sampleAt s r with
    | none => none
    | some (sm, s1) =>
      if instant < sm.instant ∧ allow = false then
        some (.err (.wouldMoveBackwards sm.instant instant), s1)
      else match check s1 instant sm with
        | some e => some (.err e, s1)
        | none =>
          match resumeState s1 sm instant wallReading r with
          | none => none
          | some s4 => (publish s4 instant sm r).map (fun s5 => (.unit, s5))

/-- A sample, a check of `target`, then a publication of `target` returning `res`. -/
def moveTo (s : St) (r : Int) (target : Int) (res : Res) (refuseBackwards countBackwards : Bool) :
    Option (Res × St) :=
  match sampleAt s r with
  | none => none
  | some (sm, s1) =>
    if refuseBackwards ∧ target < sm.instant then
      some (.err (.wouldMoveBackwards sm.instant target), s1)
    else match check s1 target sm with
      | some e => some (.err e, s1)
      | none =>
        let s2 := if countBackwards ∧ target < sm.instant then
          { s1 with backwardsSets := satU32 (s1.backwardsSets + 1) } else s1
        (publish s2 target sm r).map (fun s3 => (res, s3))

def advance (s : St) (r d : Int) : Option (Res × St) :=
  if d < 0 then some (.err .negativeDuration, s)
  else match sampleAt s r with
    | none => none
    | some (sm, s1) =>
      if fits (sm.instant + d) then moveTo s r (sm.instant + d) (.instant (sm.instant + d)) false false
      else some (.err .overflow, s1)

/-- One operation at reading `r` and wall instant `w`. `none` is a panic. -/
def step (s : St) (r w : Int) : Op → Option (Res × St)
  | .freeze =>
    match s.mode with
    | .following _ _ =>
      match sampleAt s r with
      | none => none
      | some (sm, s1) =>
        match check s1 sm.instant sm with
        | some e => some (.err e, s1)
        | none => (publish { s1 with mode := .frozen } sm.instant sm r).map (fun s2 => (.unit, s2))
    | _ => some (.unit, s)
  | .resume =>
    match s.mode with
    | .following _ _ => some (.unit, s)
    | _ => resumeTo s s.now false none r
  | .resumeAt i allow => resumeTo s i allow none r
  | .resumeWall allow =>
    if s.wall = false ∨ s.mode = .noSource then some (.noWall, s)
    else resumeTo s w allow (some r) r
  | .advance d => advance s r d
  | .tick => advance s r 1
  | .advanceTo i => moveTo s r i (.instant i) true false
  | .set i => moveTo s r i (.instant i) true false
  | .trySetAllowBackwards i => moveTo s r i .unit false true
  | .setAllowBackwards i =>
    -- The result of the checked rewind is discarded.
    (moveTo s r i .unit false true).map (fun (_, s') => (.unit, s'))
  | .restrictRange mn mx =>
    let (lo, hi) := match s.range with
      | some (l, h) => (max l mn, min h mx)
      | none => (mn, mx)
    match sampleAt s r with
    | none => none
    | some (sm, s1) =>
      if lo > hi ∨ sm.instant < lo ∨ sm.instant > hi then some (.err .outOfRange, s1)
      else some (.unit, { s1 with range := some (lo, hi) })
  | .sync =>
    match s.mode with
    | .following _ _ =>
      match sampleAt s r with
      | none => none
      | some (sm, s1) =>
        if sm.instant ≤ s.now ∨ (check s1 sm.instant sm).isSome then some (.synced false, s1)
        else (publish s1 sm.instant sm r).map (fun s2 => (.synced true, s2))
    | _ => some (.synced false, s)
  | .validateTarget i =>
    match sampleAt s r with
    | none => none
    | some (sm, s1) =>
      match check s1 i sm with
      | some e => some (.err e, s1)
      | none => some (.unit, s1)
  | .read =>
    (sampleAt s r).map (fun (sm, s1) => (.instant sm.instant, s1))

/-- What the replay test reads after each step: `now()`, then `snapshot()` (both read the
source), `backwards_sets()` and `is_following()`. -/
structure Obs where
  now : Int
  instant : Int
  elapsed : Int
  revision : Int
  backwardsSets : Int
  following : Bool
  deriving DecidableEq, Repr

def observe (s : St) (r : Int) : Option (Obs × St) :=
  match sampleAt s r with
  | none => none
  | some (sm1, s1) =>
    match sampleAt s1 r with
    | none => none
    | some (sm2, s2) =>
      some (⟨sm1.instant, sm2.instant, satU128 (s2.elapsed + sm2.counted), s2.revision,
        s2.backwardsSets, s2.following⟩, s2)

/-- How a trace starts. -/
inductive Init where
  /-- `VirtualClock::new(start)`. -/
  | new (start : Int)
  /-- `VirtualClock::new(start).with_time_source(..)`. -/
  | paused (start : Int)
  /-- `VirtualClock::following_with(start, source, reading)`. -/
  | following (start reading : Int)
  deriving DecidableEq, Repr

def Init.state (i : Init) (wall : Bool) : St :=
  let base (start : Int) (mode : Mode) : St :=
    ⟨start, mode, wall, 0, 0, 0, none⟩
  match i with
  | .new start => base start .noSource
  | .paused start => base start .frozen
  | .following start reading => base start (.following reading 0)

end VC
