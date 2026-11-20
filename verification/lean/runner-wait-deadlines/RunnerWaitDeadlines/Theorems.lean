import RunnerWaitDeadlines.Spec

namespace RunnerWaitDeadlines

theorem allowance_never_exceeds_cap (lag cap : Nat) : allowance lag cap ≤ cap :=
  Nat.min_le_right _ _

theorem exact_cap_is_not_too_loaded (base lag cap : Nat) (boundary : 2 * lag = cap) :
    (deadline base lag (some cap)).2 = false := by
  simp [deadline, boundary]

theorem above_cap_has_plateau (base lag cap : Nat) (above : cap < 2 * lag) :
    deadline base lag (some cap) = (roundSum (base + cap), true) := by
  simp [deadline, allowance, above, Nat.min_eq_right (Nat.le_of_lt above)]

theorem safe_sum_preserved (sum : Nat) (safe : sum ≤ 2 ^ 53) :
    roundSum sum = sum := by
  simp [roundSum, safe]

theorem invalid_quiet_precedes_margin (quiet : NumericInput) (margin : Option NumericInput)
    (invalid : nonnegativeSafe quiet = none) :
    quietStall quiet margin = .error "a quiet period is a non-negative integer of milliseconds" := by
  simp [quietStall, invalid]

theorem ready_precedes_every_timeout (config : Config) (state : State) (sample : Sample)
    (ready : sample.ready) : poll config state sample = .ready := by
  simp [poll, ready]

theorem failed_poll_skips_progress (config : Config) (state : State) (sample : Sample)
    (notReady : sample.ready = false) (failed : sample.failed) :
    callsOf (poll config state sample) = [.check, .failFast] := by
  simp [poll, notReady, failed, callsOf]

theorem stalled_takes_priority_over_hard_limit (config : Config) (state : State) (sample : Sample)
    (notReady : sample.ready = false) (notFailed : sample.failed = false)
    (unchanged : sample.progress = state.lastProgress)
    (pastStall : config.stall ≤ sample.tick - state.changedAt) :
    poll config state sample = .stalled := by
  simp [poll, notReady, notFailed, unchanged, pastStall]

theorem progress_does_not_extend_hard_limit (config : Config) (state : State) (sample : Sample)
    (notReady : sample.ready = false) (notFailed : sample.failed = false)
    (advanced : sample.progress ≠ state.lastProgress)
    (pastLimit : config.hard ≤ sample.tick - config.startedAt) :
    poll config state sample = .hardLimit := by
  simp [poll, notReady, notFailed, advanced, pastLimit]

theorem progress_resets_stall_window (config : Config) (state : State) (sample : Sample)
    (notReady : sample.ready = false) (notFailed : sample.failed = false)
    (advanced : sample.progress ≠ state.lastProgress)
    (withinLimit : sample.tick - config.startedAt < config.hard) :
    poll config state sample = .keepWaiting ⟨sample.progress, sample.tick⟩ := by
  simp [poll, notReady, notFailed, advanced, Nat.not_le.mpr withinLimit]

end RunnerWaitDeadlines
