import Crc32c

def main : IO Unit := do
  IO.println "# length offset chunk crc32c"
  for length in [0, 1, 7, 8, 9, 255, 256, 767, 768, 769, 24577] do
    for offset in [0, 1, 7] do
      let bytes := (List.range length).map fun i => UInt8.ofNat ((i + offset) * 31 + 7)
      let digest := CRC32C.checksum bytes
      for chunk in [1, 7, 8, 997] do
        IO.println s!"{length} {offset} {chunk} {digest.toNat}"
