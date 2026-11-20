import Std

namespace PubSubRestNegativeCache

inductive Method where
  | get | patch | delete | other
  deriving DecidableEq, Repr

inductive Outcome where
  | ok | missing | other
  deriving DecidableEq, Repr

structure Rules where
  ttl : Int
  exempts : Bool
  capacity : Nat

abbrev Key := Nat
abbrev Entries := List (Key × Int)

structure Cache where
  armed : Entries := []
  successes : Entries := []
  deriving DecidableEq, Repr

def connection (key : Key) : Nat := key / 10000

def timestamp (entries : Entries) (key : Key) : Option Int :=
  (entries.find? (fun item => item.1 == key)).map Prod.snd

def live (ttl atTime now : Int) : Bool := decide (atTime ≤ now ∧ now < atTime + ttl)

def recent (rules : Rules) (now : Int) (entries : Entries) (key : Key) : Bool :=
  (timestamp entries key).any fun atTime => live rules.ttl atTime now

def without (entries : Entries) (key : Key) : Entries :=
  entries.filter (fun item => item.1 != key)

private def prune (rules : Rules) (now : Int) (entries : Entries) : Entries :=
  entries.filter fun (_, atTime) => atTime > now || live rules.ttl atTime now

private def leastByAge (entries : Entries) : Option (Key × Int) :=
  entries.foldl (fun best item => match best with
    | none => some item
    | some old =>
      if item.2 < old.2 ∨ (item.2 = old.2 ∧ item.1 < old.1) then some item else best) none

def put (rules : Rules) (entries : Entries) (key : Key) (atTime : Int) : Entries :=
  match timestamp entries key with
  | some old => if atTime < old then entries else (key, atTime) :: without entries key
  | none =>
    if entries.length < rules.capacity then (key, atTime) :: entries
    else match leastByAge entries with
      | some (oldKey, oldTime) =>
        if oldTime < atTime then (key, atTime) :: without entries oldKey else entries
      | none => entries

def observe (rules : Rules) (cache : Cache) (key : Key) (method : Method)
    (started : Int) (result : Outcome) : Cache :=
  let cache := ⟨prune rules started cache.armed, prune rules started cache.successes⟩
  match method, result with
  | .get, .ok => { cache with successes := put rules cache.successes key started }
  | .get, .missing | .patch, .missing =>
    if (timestamp cache.armed key).isSome ||
        (rules.exempts && recent rules started cache.successes key) then cache
    else { cache with armed := put rules cache.armed key started }
  | _, _ => cache

def probe (rules : Rules) (cache : Cache) (key : Key) (method : Method)
    (now : Int) : Bool × Cache :=
  if method = .other then (false, cache) else
    match timestamp cache.armed key with
    | none => (false, cache)
    | some atTime =>
      if live rules.ttl atTime now then (true, cache)
      else if atTime ≤ now then (false, { cache with armed := without cache.armed key })
      else (false, cache)

def forget (cache : Cache) (conn : Nat) : Cache :=
  let keep := fun item : Key × Int => connection item.1 != conn
  ⟨cache.armed.filter keep, cache.successes.filter keep⟩

theorem hit_window_is_half_open (ttl atTime now : Int) :
    live ttl atTime now = true ↔ atTime ≤ now ∧ now < atTime + ttl := by
  simp [live]

theorem exact_expiry_is_not_live (ttl atTime : Int) :
    live ttl atTime (atTime + ttl) = false := by
  simp [live]

theorem hit_never_refreshes (rules : Rules) (cache : Cache) (key : Key) (method : Method)
    (atTime now : Int) (forwardedMethod : method ≠ .other)
    (found : timestamp cache.armed key = some atTime) (inWindow : live rules.ttl atTime now = true) :
    probe rules cache key method now = (true, cache) := by
  simp [probe, forwardedMethod, found, inWindow]

theorem unseen_scope_misses (rules : Rules) (cache : Cache) (key : Key) (method : Method)
    (now : Int) (absent : timestamp cache.armed key = none) :
    probe rules cache key method now = (false, cache) := by
  by_cases h : method = .other <;> simp [probe, h, absent]

theorem closed_connection_has_no_armed_row (cache : Cache) (conn : Nat) :
    ∀ item ∈ (forget cache conn).armed, connection item.1 ≠ conn := by
  intro item member
  have kept := (List.mem_filter.mp member).2
  simpa using kept

end PubSubRestNegativeCache

/- Guard the axioms used by the stated laws. -/

/-- info: 'PubSubRestNegativeCache.hit_window_is_half_open' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubRestNegativeCache.hit_window_is_half_open

/-- info: 'PubSubRestNegativeCache.exact_expiry_is_not_live' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubRestNegativeCache.exact_expiry_is_not_live

/-- info: 'PubSubRestNegativeCache.hit_never_refreshes' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubRestNegativeCache.hit_never_refreshes

/-- info: 'PubSubRestNegativeCache.unseen_scope_misses' depends on axioms: [propext] -/
#guard_msgs in #print axioms PubSubRestNegativeCache.unseen_scope_misses

/-- info: 'PubSubRestNegativeCache.closed_connection_has_no_armed_row' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubRestNegativeCache.closed_connection_has_no_armed_row
