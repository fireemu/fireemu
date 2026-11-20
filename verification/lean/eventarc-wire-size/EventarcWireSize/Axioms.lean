import EventarcWireSize.Theorems

/-! Build-time proof dependency guards. -/

/-- info: 'EWS.zero_varint' does not depend on any axioms -/
#guard_msgs in #print axioms EWS.zero_varint

/-- info: 'EWS.varint_positive' depends on axioms: [propext] -/
#guard_msgs in #print axioms EWS.varint_positive

/-- info: 'EWS.varint_monotone' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EWS.varint_monotone

/-- info: 'EWS.field_strict_mono' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EWS.field_strict_mono

/-- info: 'EWS.any_strict_mono' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EWS.any_strict_mono

/-- info: 'EWS.peer_adds_framed_event' depends on axioms: [propext] -/
#guard_msgs in #print axioms EWS.peer_adds_framed_event

/-- info: 'EWS.count_precedes_size' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EWS.count_precedes_size

/-- info: 'EWS.exact_any_limit_is_delivered' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EWS.exact_any_limit_is_delivered

/-- info: 'EWS.oversized_precedes_binary' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms EWS.oversized_precedes_binary
