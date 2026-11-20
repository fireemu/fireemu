import ExportWire.Theorems

/-- info: 'ExportWire.digit_count' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportWire.digit_count

/-- info: 'ExportWire.next_digit_fits' depends on axioms: [propext] -/
#guard_msgs in #print axioms ExportWire.next_digit_fits

/-- info: 'ExportWire.expanding_then_decoding' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportWire.expanding_then_decoding

/-- info: 'ExportWire.u64_roundtrip' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportWire.u64_roundtrip

/-- info: 'ExportWire.signed_bits_roundtrip' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportWire.signed_bits_roundtrip

/-- info: 'ExportWire.eleven_continuation_bytes_refused' depends on axioms: [propext] -/
#guard_msgs in #print axioms ExportWire.eleven_continuation_bytes_refused

/-- info: 'ExportWire.tenth_byte_cannot_widen_u64' depends on axioms: [propext] -/
#guard_msgs in #print axioms ExportWire.tenth_byte_cannot_widen_u64
