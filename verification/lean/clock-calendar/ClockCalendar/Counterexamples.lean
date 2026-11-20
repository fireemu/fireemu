import ClockCalendar.Reference

namespace CC

local instance : DecidableEq (Except Error Int) := fun a b =>
  match a, b with
  | .ok x, .ok y => decidable_of_iff (x = y) ⟨congrArg Except.ok, Except.ok.inj⟩
  | .error x, .error y => decidable_of_iff (x = y) ⟨congrArg Except.error, Except.error.inj⟩
  | .ok _, .error _ => isFalse (fun h => nomatch h)
  | .error _, .ok _ => isFalse (fun h => nomatch h)

private def midnight (y m d : Int) : Int := (⟨y, m, d, 0⟩ : Civil).instant 0

theorem combined_year_month_differs :
    moveInstant (midnight 2024 2 29) 0 (some { years := 1 }) none = .ok (midnight 2025 2 28) ∧
    moveInstant (midnight 2025 2 28) 0 (some { months := 1 }) none = .ok (midnight 2025 3 28) ∧
    moveInstant (midnight 2024 2 29) 0 (some { years := 1, months := 1 }) none = .ok (midnight 2025 3 29) ∧
    midnight 2025 3 28 ≠ midnight 2025 3 29 := by decide

theorem month_inverse_loses_clamped_day :
    moveInstant (midnight 2024 1 31) 0 (some { months := 1 }) none = .ok (midnight 2024 2 29) ∧
    moveInstant (midnight 2024 2 29) 0 (some { negative := true, months := 1 }) none = .ok (midnight 2024 1 29) ∧
    midnight 2024 1 29 ≠ midnight 2024 1 31 := by decide

theorem next_month_is_not_idempotent :
    moveInstant (midnight 2024 1 31) 0 none (some .startOfNextMonth) = .ok (midnight 2024 2 1) ∧
    moveInstant (midnight 2024 2 1) 0 none (some .startOfNextMonth) = .ok (midnight 2024 3 1) ∧
    midnight 2024 2 1 ≠ midnight 2024 3 1 := by decide

theorem clock_inverse_can_leave_range :
    moveInstant (midnight 1 1 1 - 1) 0 (some { seconds := 1 }) none = .ok (midnight 1 1 1 + nsSecond - 1) ∧
    moveInstant (midnight 1 1 1 + nsSecond - 1) 0 (some { negative := true, seconds := 1 }) none =
      .error .yearOutOfRange := by decide

theorem day_end_excludes_submicrosecond_tail :
    let t := midnight 2024 2 29 + nsDay - 1
    let e := midnight 2024 2 29 + lastMicrosecond
    moveInstant t 0 none (some .endOfDay) = .ok e ∧ e < t ∧ t = e + 999 := by decide

theorem next_boundary_can_leave_range :
    let t := midnight 9999 12 31
    moveInstant t 0 none (some .endOfMonth) = .ok (t + lastMicrosecond) ∧
    moveInstant t 0 none (some .startOfNextMonth) = .error .yearOutOfRange ∧
    moveInstant t 0 (some { days := 1 }) (some .startOfDay) = .error .yearOutOfRange := by decide

theorem model_reference_agree_at_local_year_edges :
    let lo := midnight 1 1 1
    let hi := midnight 10000 1 1
    let hour := 3600 * nsSecond
    let cases : List (Int × Int × Option Duration × Int) := [
      (lo - 1, 0, some { seconds := 1 }, lo + nsSecond - 1),
      (hi, 0, some { negative := true, seconds := 1 }, hi - nsSecond),
      (lo, -3600, none, lo),
      (lo, -3600, some { hours := 1 }, lo + hour),
      (lo + hour, -3600, some { negative := true, seconds := 1 }, lo + hour - nsSecond),
      (hi - hour - 1, 3600, some { seconds := 1 }, hi - hour + nsSecond - 1)]
    (cases.all fun (t, z, d, r) =>
      decide (moveInstant t z d none = .ok r ∧ referenceMove t z d none = .ok r)) = true := by
  decide

end CC
