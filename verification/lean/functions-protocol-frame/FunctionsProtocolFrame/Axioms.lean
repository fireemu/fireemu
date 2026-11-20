import FunctionsProtocolFrame.Theorems

/-! Build-time checks for the permitted Lean axioms. -/

/-- info: 'FunctionsProtocolFrame.header_suffix' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FunctionsProtocolFrame.header_suffix

/-- info: 'FunctionsProtocolFrame.header_success_respects_cap' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsProtocolFrame.header_success_respects_cap

/-- info: 'FunctionsProtocolFrame.separates_consecutive_payloads' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsProtocolFrame.separates_consecutive_payloads

/-- info: 'FunctionsProtocolFrame.refuses_incomplete_payload' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsProtocolFrame.refuses_incomplete_payload

/-- info: 'FunctionsProtocolFrame.encoded_body_is_unchanged' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FunctionsProtocolFrame.encoded_body_is_unchanged

/-- info: 'FunctionsProtocolFrame.digit_limit_stops_before_body' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FunctionsProtocolFrame.digit_limit_stops_before_body

/-- info: 'FunctionsProtocolFrame.highest_accepted_length_is_inclusive' depends on axioms: [propext] -/
#guard_msgs in #print axioms FunctionsProtocolFrame.highest_accepted_length_is_inclusive
