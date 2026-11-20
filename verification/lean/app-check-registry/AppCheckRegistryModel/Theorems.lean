import AppCheckRegistryModel.Spec

namespace AppCheckRegistryModel

theorem unselected_project_keeps_records (registry : Registry) (scope : Scope)
    (snapshot : App → Option (List Record)) (app : App) (excluded : accepts scope app = false) :
    (restore registry scope snapshot).live app = registry.live app := by
  simp [restore, excluded]

theorem restore_capture_replaces (before after : Registry) (snapshotScope restoreScope : Scope)
    (app : App) (captured : accepts snapshotScope app = true)
    (selected : accepts restoreScope app = true) :
    (restore after restoreScope (capture before snapshotScope)).live app = before.live app := by
  simp [restore, capture, captured, selected]

theorem selected_uncaptured_project_is_empty (before after : Registry) (snapshotScope restoreScope : Scope)
    (app : App) (absent : accepts snapshotScope app = false)
    (selected : accepts restoreScope app = true) :
    (restore after restoreScope (capture before snapshotScope)).live app = [] := by
  simp [restore, capture, absent, selected]

theorem restoring_twice_is_stable (registry : Registry) (scope : Scope)
    (snapshot : App → Option (List Record)) (app : App) :
    (restore (restore registry scope snapshot) scope snapshot).live app =
      (restore registry scope snapshot).live app := by
  cases chosen : accepts scope app <;> simp [restore, chosen]

theorem rejected_add_does_not_add_record (registry : Registry) (app : App)
    (label : String) (time : Nat) (full : 128 ≤ staticCount registry app + (registry.live app).length) :
    (add registry app label time).2.live = registry.live := by
  simp [add, full]

theorem rotation_resets_numbering (state : EpochState) (value : Nat) :
    (issue (rotate state value) .first).1 = .ok (value, 1) := rfl

theorem disabled_never_advances_counter (state : EpochState) :
    issue state .second = (.error .disabled, state) := rfl

theorem fresh_issue_advances_sequence (state : EpochState) (value : Nat)
    (present : state.value = some value) :
    (issue state .first).2.session = state.session + 1 := by
  simp [issue, present]

end AppCheckRegistryModel
