import RulesCoveragePreviews

open RulesCoveragePreviews

def shapes : List (String × Char) :=
  [("ascii", 'Y'), ("two", 'é'), ("three", '漢'), ("four", '🔥')]

def main : IO Unit := do
  IO.println "# 48 cases"
  for (width, scalar) in shapes do
    let scalarWidth := (String.singleton scalar).utf8ByteSize
    for (remainder, remainingBytes) in
        [("fit", scalarWidth + 1), ("cross", scalarWidth - 1), ("edge", scalarWidth)] do
      let asciiCount := 1024 - remainingBytes
      let widths := List.replicate asciiCount 1 ++ [scalarWidth, 1]
      for kind in ["value", "cause"] do
        for pretag in [false, true] do
          let result := preview 1024 widths pretag
          IO.println (String.intercalate "\t" [width, remainder, kind,
            if pretag then "truncated" else "plain", toString asciiCount,
            toString result.retained.length, toString (cost result.retained), toString result.truncated])
