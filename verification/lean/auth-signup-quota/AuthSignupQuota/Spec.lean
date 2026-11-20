import Std

namespace AuthSignupQuota

def hour : Int := 3600000000000

def window (instant : Int) : Int := instant - instant % hour

def overrideActive (start duration instant : Int) : Bool :=
  start ≤ instant && instant < start + duration

inductive ConfigError where
  | defaultLimit | buckets | quota | duration | overflow
  deriving DecidableEq, Repr

def validate (limit buckets : Nat) : Option ConfigError :=
  if limit > 1000000 then some .defaultLimit
  else if buckets = 0 || buckets > 65536 then some .buckets
  else none

def validateTemporary (quota : Nat) (start duration : Int) : Option ConfigError :=
  if quota ≥ 2 ^ 63 then some .quota
  else if duration ≤ 0 then some .duration
  else if start + duration ≥ 2 ^ 127 then some .overflow
  else none

inductive Mode where
  | off | observe | enforce
  deriving DecidableEq, Repr

structure Usage where
  committed : Nat := 0
  held : Nat := 0
  deriving DecidableEq, Repr

inductive Offer where
  | untracked
  | tracked (overage : Bool)
  | exceeds
  | invalidPeer
  deriving DecidableEq, Repr

def offer (mode : Mode) (limit : Nat) (usage : Usage) : Offer :=
  match mode with
  | .off => .untracked
  | .observe => .tracked (usage.committed + usage.held ≥ limit)
  | .enforce => if usage.committed + usage.held < limit then .tracked false else .exceeds

def addReservation (usage : Usage) (decision : Offer) : Usage :=
  match decision with
  | .tracked _ => { usage with held := usage.held + 1 }
  | _ => usage

def releaseTracked (usage : Usage) : Usage :=
  { usage with held := usage.held - 1 }

def commitTracked (usage : Usage) : Usage :=
  { committed := usage.committed + 1, held := usage.held - 1 }

def validPeer (peer : String) : Bool :=
  !peer.isEmpty && peer.toList.all fun c => !(c.toNat < 32 || (127 ≤ c.toNat && c.toNat ≤ 159))

structure Snapshot where
  mode : Mode
  generation : Nat
  now : Int
  limit : Nat
  deriving Repr

def fresh (before after : Snapshot) (tracked : Bool) : Bool :=
  (before.mode == after.mode) && before.generation == after.generation &&
    (!tracked || (window before.now == window after.now && before.limit == after.limit))

inductive Finalizer where
  | commit | release
  deriving DecidableEq, Repr

inductive Outcome where
  | ok | stale | invalid
  deriving DecidableEq, Repr

def finalize (before after : Snapshot) (action : Finalizer) (tracked active : Bool)
    (usage : Usage) : Outcome × Usage :=
  if tracked then
    if !active then (.invalid, usage)
    else if action == .release then (.ok, releaseTracked usage)
    else if fresh before after true then (.ok, commitTracked usage)
    else (.stale, releaseTracked usage)
  else if action == .release || fresh before after false then (.ok, usage) else (.stale, usage)

end AuthSignupQuota
