import Std

namespace CRC32C

/-- One reflected recurrence step for the Castagnoli generator polynomial. -/
def step (state : UInt32) : UInt32 :=
  (state >>> 1) ^^^ (if state &&& 1 = 1 then 0x82f63b78 else 0)

def feedByte (state : UInt32) (byte : UInt8) : UInt32 :=
  (List.range 8).foldl (fun state _ => step state) (state ^^^ byte.toUInt32)

def feed (state : UInt32) (bytes : List UInt8) : UInt32 :=
  bytes.foldl feedByte state

def checksum (bytes : List UInt8) : UInt32 :=
  ~~~(feed 0xffffffff bytes)

end CRC32C
