import NpmClockDuration.Spec

namespace NpmClockDuration

theorem all_zero_parts_use_seconds (negative : Bool) :
    formatParts negative [] [] = "PT0S" := by
  rfl

theorem nonzero_units_keep_canonical_order (fields : Fields) (order : List (String × String)) :
    List.Sublist ((amounts fields order).map Prod.snd) (order.map Prod.snd) := by
  induction order with
  | nil => exact .slnil
  | cons entry rest ih =>
    rcases entry with ⟨key, unit⟩
    by_cases missing : ((fields.lookup key).map Scalar.magnitude).getD 0 = 0
    · simpa [amounts, missing] using (List.Sublist.cons unit ih)
    · simpa [amounts, missing] using (List.Sublist.cons_cons unit ih)

theorem legacy_object_passes_through (fields : Fields)
    (calendar : hasCalendar fields = false)
    (hasLegacyKey : has fields "seconds" || has fields "millis") :
    advance (.object fields) {} = .ok fields := by
  simp [advance, calendar, legacyBody, Options.present, hasLegacyKey]

theorem legacy_options_are_rejected (input : Input) (options : Options)
    (present : options.present) :
    legacyBody input options =
      .error "timeZone and allowBackwards require an ISO 8601 duration or calendar units" := by
  simp [legacyBody, present]

theorem millis_conflict_wins (fields : Fields) (options : Options)
    (calendar : hasCalendar fields) (millis : has fields "millis") :
    advance (.object fields) options = .error "millis cannot be combined with calendar units" := by
  simp [advance, calendar, millis]

theorem invalid_duration_precedes_options (duration : Input) (options : Options) (reason : String)
    (invalid : durationText duration = .error reason) :
    calendarBody duration options = .error reason := by
  unfold calendarBody
  rw [invalid]
  rfl

theorem anchor_checks_target_first (duration : Option Input) (options : Options) (target : Int) :
    anchor (.integer target) duration options = .error "the anchor must be a string such as endOfMonth" := by
  rfl

theorem invalid_zone_precedes_backwards (backwards : Option Scalar) :
    moveOptions ⟨some .null, backwards⟩ = .error "timeZone must be a string" := by
  rfl

theorem raw_duration_keeps_spelling (raw zone : String) (backwards : Bool) :
    advance (.scalar (.text raw)) ⟨some (.text zone), some (.flag backwards)⟩ =
      .ok [("duration", .text raw), ("timeZone", .text zone), ("allowBackwards", .flag backwards)] := by
  rfl

end NpmClockDuration
