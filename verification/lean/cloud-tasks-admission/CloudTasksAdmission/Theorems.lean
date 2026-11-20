import CloudTasksAdmission.Spec

namespace CTAdmission

theorem unknown_field_wins (syntaxState fields now defaultSeconds) :
    admit .request syntaxState fields now defaultSeconds = (false, .error "unknownRequest") := rfl

theorem both_parse_errors_precede_payload (fields now defaultSeconds) :
    admit .none .both fields now defaultSeconds = (false, .error "bothSyntax") := rfl

theorem size_callback_only_after_precheck (unknown syntaxState fields now defaultSeconds) :
    (admit unknown syntaxState fields now defaultSeconds).1 = (precheck unknown syntaxState fields now).isNone := by
  unfold admit
  cases precheck unknown syntaxState fields now <;> rfl

theorem schedule_is_microsecond_aligned (now : Int) (scheduled : Option Int) :
    scheduleFor now scheduled % 1000 = 0 := by
  dsimp [scheduleFor]
  omega

theorem past_uses_floored_now (now scheduled : Int) (h : scheduled ≤ now) :
    scheduleFor now (some scheduled) = now - now % 1000 := by
  simp [scheduleFor, Int.max_eq_left h]

theorem zero_deadline_uses_default (defaultSeconds : Int) :
    deadlineFor defaultSeconds (some 0) = deadlineFor defaultSeconds none := rfl

end CTAdmission
