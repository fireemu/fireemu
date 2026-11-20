import CloudTasksQueue.Spec

namespace CTQ

theorem stale_finish_is_ignored (s : State) (old : Stamp) (reuse : Reuse) (time : Nat)
    (h : old.generation ≠ s.generation) : complete reuse time s (some old) = (false, s) := by
  unfold complete
  cases s.phase <;> simp [h]

theorem reset_changes_generation (s : State) : (reset s).generation ≠ s.generation := by
  simp [reset]

theorem reset_clears_occupancy (s : State) : outstanding (reset s).phase = 0 := by
  rfl

theorem pending_delete_does_not_require_due (s : State) (id : Nat) (forced : Bool)
    (reuse : Reuse) (schedule : Schedule) (time : Nat) (h : s.phase = .pending id forced) :
    (perform reuse schedule time .delete s).1 = "true" := by
  simp [perform, h, observe]

theorem exact_window_expiration (finish : Nat) :
    observe .window (finish + 2) (.finished finish) = .free := by
  unfold observe
  have elapsed : finish + 2 - finish = 2 := by omega
  simp [elapsed]

theorem window_retains_before_boundary (finish now : Nat) (h : now - finish < 2) :
    observe .window now (.finished finish) = .finished finish := by
  simp [observe, Nat.not_le.mpr h]

end CTQ
