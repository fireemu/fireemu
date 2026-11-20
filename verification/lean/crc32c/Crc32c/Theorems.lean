import Crc32c.Spec

namespace CRC32C

theorem feed_append (state : UInt32) (a b : List UInt8) :
    feed state (a ++ b) = feed (feed state a) b :=
  List.foldl_append

theorem feed_chunks (state : UInt32) (chunks : List (List UInt8)) :
    feed state chunks.flatten = chunks.foldl feed state := by
  induction chunks generalizing state with
  | nil => rfl
  | cons head tail ih =>
    change feed state (head ++ tail.flatten) = tail.foldl feed (feed state head)
    rw [feed_append, ih]

theorem empty_checksum : checksum [] = 0 := by decide

set_option maxRecDepth 10000 in
theorem check_vector :
    checksum "123456789".toUTF8.data.toList = 0xe3069283 := by decide

end CRC32C
