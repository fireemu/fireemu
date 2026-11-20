import ExportPartitions

open ExportPartitions

def collections : List (String × List String) :=
  [("none", []), ("single", ["posts"]), ("multi", ["users", "posts", "不存在"]),
    ("duplicate", ["posts", "posts"])]

def namespaces : List (String × List String) :=
  [("absent", []), ("empty", [""]), ("named", ["outside"]), ("multi", ["z", "", "a"]),
    ("duplicate", ["", ""])]

def fixtures : List (String × List Document) :=
  [("empty", []),
    ("populated",
      [⟨"posts", "posts/p2"⟩, ⟨"posts", "users/使用者/posts/p1"⟩,
        ⟨"users", "users/使用者"⟩, ⟨"cities", "cities/c1"⟩])]

def rendered : Partition → String
  | .all => "all"
  | .kind c => "kind:" ++ c
  | .namespace n => "ns:" ++ n

def selectedDocs (docs : List Document) (p : Partition) : String :=
  match (documentsFor docs p).map Document.path with
  | [] => "-"
  | paths => ",".intercalate paths

def main : IO Unit := do
  IO.println "# COLLECTIONS NAMESPACES DOCUMENTS PARTITIONS FILES SELECTIONS OVERALL, tab separated"
  for (collectionCase, cs) in collections do
    for (namespaceCase, ns) in namespaces do
      for (documentCase, docs) in fixtures do
        let parts := select cs ns
        let metadataNames := parts.map metadata
        let overall := if metadataNames.eraseDups.length < metadataNames.length
          then "duplicate" else "ok"
        IO.println ("\t".intercalate [
          collectionCase, namespaceCase, documentCase,
          ",".intercalate (parts.map rendered), ",".intercalate (files "export" parts),
          ";".intercalate (parts.map (selectedDocs docs)), overall])
