import EventTransition.Spec

namespace EventTransition

theorem terminal_precedes_action_validation (s : Record) (a : Action) (p : Probe)
    (h : s.phase.terminal = true) : step s a p = .error "terminal" := by
  simp [step, h]

theorem rejection_preserves_record (s : Record) (a : Action) (p : Probe) (e : String)
    (h : step s a p = .error e) : after s a p = s := by
  simp [after, h, Except.toOption]

theorem terminal_stays_terminal (s : Record) (a : Action) (p : Probe)
    (h : s.phase.terminal = true) : after s a p = s :=
  rejection_preserves_record s a p "terminal" (terminal_precedes_action_validation s a p h)

theorem interruption_returns_attempt (s : Record) (p : Probe) (h : s.phase = .running) :
    step s .interrupt p = .ok ({ s with phase := .pending, attempt := s.attempt - 1 }, "ok") := by
  simp [step, h, Phase.terminal, Action.requires]

theorem retry_at_due_time (s : Record) (p : Probe) (h : s.phase = .waiting)
    (due : s.retryAt ≤ p.now) : step s .retry p = .ok ({ s with phase := .pending }, "ok") := by
  simp [step, h, Phase.terminal, Action.requires, Int.not_lt.mpr due]

theorem retry_before_due_time (s : Record) (p : Probe) (h : s.phase = .waiting)
    (early : p.now < s.retryAt) : step s .retry p = .error "not-due" := by
  simp [step, h, Phase.terminal, Action.requires, early]

theorem successful_start_charges_attempt (s : Record) (p : Probe) (h : s.phase = .leased)
    (fits : s.attempt < maxAttempt) :
    step s .start p = .ok ({ s with phase := .running, attempt := s.attempt + 1 }, "ok") := by
  simp [step, h, Phase.terminal, Action.requires, Nat.not_le.mpr fits]

end EventTransition
