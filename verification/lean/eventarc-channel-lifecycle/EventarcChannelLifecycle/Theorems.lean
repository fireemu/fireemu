import EventarcChannelLifecycle.Spec

namespace ECL

theorem settle_monotone (s : State) (wall : Nat) : s.clock ≤ (settle s wall).clock := by
  exact Nat.le_max_right _ _

theorem settle_keeps_high_water (s : State) (wall : Nat) (past : wall ≤ s.clock) :
    (settle s wall).clock = s.clock := Nat.max_eq_right past

theorem early_deletion_waits_for_creation (s : State) (r : Record)
    (existsChannel : s.channel = some r) (notDeleting : r.retiring = none) (early : s.clock < r.readyAt) :
    ((delete s).2.channel.map (fun c => c.retiring)) = some (some (s.clock, r.readyAt + deleteDelay)) := by
  simp [delete, existsChannel, notDeleting, Nat.max_eq_right (Nat.le_of_lt early)]

theorem delete_twice_preserves_state (s : State) (r : Record) (start finish : Nat)
    (found : s.channel = some r) (retiring : r.retiring = some (start, finish)) :
    delete s = (.missing, s) := by simp [delete, found, retiring]

theorem retirement_at_deadline (s : State) (r : Record) (start finish : Nat)
    (found : s.channel = some r) (retiring : r.retiring = some (start, finish)) :
    (settle s finish).channel = none := by
  simp [settle, found, retiring, Nat.le_max_left]

theorem new_identity_when_absent (s : State) (declared : Bool) (absent : s.channel = none) :
    ((create s declared).2.channel.map (·.uid)) = some (s.assigned + 1) := by
  cases declared <;> simp [create, absent]

end ECL
