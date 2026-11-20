import Crc32c.Theorems

/-! Guard that the specification proofs use only Lean's standard axioms. -/

/-- info: 'CRC32C.feed_append' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CRC32C.feed_append

/-- info: 'CRC32C.feed_chunks' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CRC32C.feed_chunks

/-- info: 'CRC32C.empty_checksum' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CRC32C.empty_checksum

/-- info: 'CRC32C.check_vector' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms CRC32C.check_vector
