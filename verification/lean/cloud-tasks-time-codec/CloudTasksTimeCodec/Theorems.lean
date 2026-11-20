import CloudTasksTimeCodec.Spec

namespace CTTime

theorem split_reconstructs (nanos : Int) :
    nanos / scale * scale + nanos % scale = nanos := by
  unfold scale
  omega

theorem fractional_remainder_in_bounds (nanos : Int) :
    0 ≤ nanos % scale ∧ nanos % scale < scale := by
  unfold scale
  omega

theorem epoch_offset_applied :
    parseTimestamp "1970-01-01T00:00:00+00:01" = some (-60 * scale) := by decide

theorem timestamp_leap_second_carries_to_midnight :
    parseTimestamp "2024-12-31T23:59:60Z" = parseTimestamp "2025-01-01T00:00:00Z" := by decide

theorem negative_fraction_does_not_round_trip :
    parseDuration (formatDuration (-500000000)) = some (-1500000000) := by decide

theorem duration_accepts_upper_second_with_fraction :
    parseDuration "315576000000.999999999s" = some 315576000000999999999 := by decide

end CTTime
