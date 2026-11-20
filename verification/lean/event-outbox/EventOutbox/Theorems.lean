import EventOutbox.Spec

namespace EventOutbox

theorem ordered_key_transitive (a b c : Nat × Nat)
    (h₁ : keyLE a b = true) (h₂ : keyLE b c = true) : keyLE a c = true := by
  simp [keyLE] at h₁ h₂ ⊢
  omega

theorem ordered_key_total (a b : Nat × Nat) : keyLE a b || keyLE b a := by
  simp [keyLE]
  omega

theorem dispatch_is_canonical (s : State) :
    s.pending.Pairwise (fun a b => keyLE a.key b.key = true) := by
  unfold State.pending
  exact List.pairwise_mergeSort
    (fun a b c => ordered_key_transitive a.key b.key c.key)
    (fun a b => ordered_key_total a.key b.key) _

theorem pending_exact (s : State) (e : Entry) :
    e ∈ s.pending ↔ e ∈ s.entries ∧ e.phase = .pending := by
  simp [State.pending]

theorem queue_exact (s : State) (e : Entry) (q : String) :
    e ∈ s.queue q ↔ e ∈ s.entries ∧ e.phase = .pending ∧ e.queue = q := by
  simp [State.queue, pending_exact, and_assoc]

theorem terminal_window_is_bounded (retention : Nat) (retired : List Nat) :
    (retainedTerminal retention retired).length ≤ max 1 retention := by
  simp [retainedTerminal]
  omega

theorem terminal_window_keeps_everything_that_fits (retention : Nat) (retired : List Nat)
    (h : retired.length ≤ max 1 retention) :
    retainedTerminal retention retired = retired := by
  simp [retainedTerminal, Nat.sub_eq_zero_of_le h]

theorem duplicate_preserves_views (s : State) (e : Entry) (h : (s.lookup e.id).isSome) :
    step s (.enqueue e) = (s, "duplicate") := by
  simp [step, h]

end EventOutbox
