import AuthBase32.Theorems

/-- info: 'AuthBase32.padded_symbol_count' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms AuthBase32.padded_symbol_count

/-- info: 'AuthBase32.decoded_octet_count' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms AuthBase32.decoded_octet_count

/-- info: 'AuthBase32.padding_alignment' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms AuthBase32.padding_alignment

/-- info: 'AuthBase32.encoded_length_is_aligned' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthBase32.encoded_length_is_aligned

/-- info: 'AuthBase32.prefix_stops_at_padding' depends on axioms: [propext] -/
#guard_msgs in #print axioms AuthBase32.prefix_stops_at_padding

/-- info: 'AuthBase32.trailing_text_has_no_effect' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthBase32.trailing_text_has_no_effect
