import Rfc3339Time.Text

/-!
Build-time guard: every public theorem uses only Lean's standard logical axioms.
-/

/-- info: 'RfcTime.civil_from_days_days_from_civil' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.civil_from_days_days_from_civil

/-- info: 'RfcTime.civil_from_days_valid' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.civil_from_days_valid

/-- info: 'RfcTime.days_from_civil_civil_from_days' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.days_from_civil_civil_from_days

/-- info: 'RfcTime.days_from_civil_strict_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.days_from_civil_strict_mono

/-- info: 'RfcTime.daysInMonth_bound' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.daysInMonth_bound

/-- info: 'RfcTime.civil_i64_never_clamps' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.civil_i64_never_clamps

/-- info: 'RfcTime.checked_days_strict_mono' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.checked_days_strict_mono

/-- info: 'RfcTime.civil_checked_round_trip' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.civil_checked_round_trip

/-- info: 'RfcTime.days_from_civil_checked_right_inverse' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.days_from_civil_checked_right_inverse

/-- info: 'RfcTime.i64_max_day_overflows_on_conversion_back' does not depend on any axioms -/
#guard_msgs in #print axioms RfcTime.i64_max_day_overflows_on_conversion_back

/-- info: 'RfcTime.i64_min_year_january_overflows' does not depend on any axioms -/
#guard_msgs in #print axioms RfcTime.i64_min_year_january_overflows

/-- info: 'RfcTime.wrapping_days_can_reverse_calendar_order' does not depend on any axioms -/
#guard_msgs in #print axioms RfcTime.wrapping_days_can_reverse_calendar_order

/-- info: 'RfcTime.raw_civil_date_can_normalize' does not depend on any axioms -/
#guard_msgs in #print axioms RfcTime.raw_civil_date_can_normalize

/-- info: 'RfcTime.parse_accepts_exactly_grammar' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.parse_accepts_exactly_grammar

/-- info: 'RfcTime.equivalent_texts_parse_equal' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.equivalent_texts_parse_equal

/-- info: 'RfcTime.parse_rfc3339_accepts_exactly_grammar' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.parse_rfc3339_accepts_exactly_grammar

/-- info: 'RfcTime.equivalent_rfc3339_texts_parse_equal' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.equivalent_rfc3339_texts_parse_equal

/-- info: 'RfcTime.representable_iff_nanos' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.representable_iff_nanos

/-- info: 'RfcTime.format_then_parse' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.format_then_parse

/-- info: 'RfcTime.parsed_in_range_formats' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.parsed_in_range_formats

/-- info: 'RfcTime.format_error_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.format_error_iff

/-- info: 'RfcTime.offset_crosses_below_four_digit_utc_year' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.offset_crosses_below_four_digit_utc_year

/-- info: 'RfcTime.offset_crosses_above_four_digit_utc_year' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.offset_crosses_above_four_digit_utc_year

/-- info: 'RfcTime.leap_second_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RfcTime.leap_second_refused
