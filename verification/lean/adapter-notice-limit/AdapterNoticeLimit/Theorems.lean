import AdapterNoticeLimit.Spec

namespace AN

theorem seen_bounded (cap : Nat) (s : State) (name : Nat) (h : s.seen.length ≤ cap) :
    (observe cap s name).1.seen.length ≤ cap := by
  unfold observe
  split
  · exact h
  · split
    · simp
      omega
    · split <;> exact h

theorem duplicate_is_silent (cap : Nat) (s : State) (name : Nat)
    (h : s.seen.contains name = true) :
    observe cap s name = (s, .silent) := by unfold observe; rw [h]; rfl

theorem suppression_is_irreversible (cap : Nat) (s : State) (name : Nat)
    (h : s.suppressed = true) :
    (observe cap s name).1.suppressed = true := by
  unfold observe
  split
  · exact h
  · split
    · exact h
    · simp [h]

theorem saturated_and_suppressed_is_silent (cap : Nat) (s : State) (name : Nat)
    (h : s.seen.length = cap) (stop : s.suppressed = true) :
    observe cap s name = (s, .silent) := by
  simp [observe, h, stop]

end AN
