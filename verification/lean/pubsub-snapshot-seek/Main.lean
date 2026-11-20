import PubsubSnapshotSeek

open SnapshotSeek

def admit (filter : String) (message : Message) : Bool :=
  filter == "all" || (filter == "keep" && message.keep)

def main : IO Unit := do
  IO.println "# target membership|pending bitmask|filter|post time|expected pull order"
  let first : Message := ⟨"a", 10, true⟩
  let second : Message := ⟨"b", 8, false⟩
  let old : Message := ⟨"old", 9, true⟩
  for members in ["fresh", "partial", "covered"] do
    for mask in List.range 4 do
      let pending := (if mask % 2 == 1 then [first.id] else []) ++
        (if mask / 2 == 1 then [second.id] else [])
      for filter in ["all", "keep", "reject"] do
        for published in ([9, 10, 11] : List Int) do
          let initial := if members == "covered" then [first, second]
            else if members == "partial" then [second] else []
          let post : Message := ⟨"post", published, true⟩
          let target := ([old] ++ initial ++ [post]).filter (admit filter)
          let ids := replay 10 (admit filter) [first, second] pending target
          IO.println s!"{members}|{mask}|{filter}|{published}|{String.intercalate "," ids}"
