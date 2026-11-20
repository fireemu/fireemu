import WireCodecs.Theorems

/-! Guard that the specification proofs use only Lean's standard axioms. -/

/-- info: 'WC.escape_append' depends on axioms: [propext] -/
#guard_msgs in #print axioms WC.escape_append

/-- info: 'WC.percent_length' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms WC.percent_length

/-- info: 'WC.no_recursive_decoding' depends on axioms: [propext] -/
#guard_msgs in #print axioms WC.no_recursive_decoding

/-- info: 'WC.malformed_suffix_remains_visible' depends on axioms: [propext] -/
#guard_msgs in #print axioms WC.malformed_suffix_remains_visible

/-- info: 'WC.hex_nibble_bounded' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms WC.hex_nibble_bounded
