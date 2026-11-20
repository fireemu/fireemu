import ExportMetadata

open EM

def paths : List (String × List (String × Wire)) :=
  [("good", [("path", .string "products/part")]),
    ("empty", [("path", .string "")]),
    ("blankMember", [("path", .other)]),
    ("missing", []),
    ("absolute", [("path", .string "/part")]),
    ("dotdot", [("path", .string "products/../part")])]

def versions : List (String × List (String × Wire)) :=
  [("present", [("version", .string "2.3")]), ("missing", []),
    ("object", [("version", .object [])])]

def sidecars : List (String × List (String × Wire)) :=
  [("missing", []), ("good", [("metadata_file", .string "metadata/data")]),
    ("empty", [("metadata_file", .string "")]), ("wrong", [("metadata_file", .other)]),
    ("absolute", [("metadata_file", .string "/data")]),
    ("dotdot", [("metadata_file", .string "metadata/../data")])]

def root (extras : List (String × Wire)) : Wire :=
  .object (("version", .string "1.0") :: extras)

def row (kind : String) (labels : List String) (value : Wire)
    (result : Except String String) : String :=
  let result := match result with
    | .ok state => ["ok", state]
    | .error diag => ["err", diag]
  String.intercalate "\t" ([kind] ++ labels ++ [render value] ++ result)

def manifestRow (labels : List String) (value : Wire) :=
  row "manifest" labels value ((manifest value).map Manifest.signature)

def manifestMatrix : List String :=
  productOrder.flatMap fun product =>
    paths.flatMap fun (path, pathFields) =>
      versions.flatMap fun (version, versionFields) =>
        sidecars.map fun (sidecar, sidecarFields) =>
          let value := root [(product, .object (pathFields ++ versionFields ++ sidecarFields))]
          manifestRow [product, path, version, sidecar] value

def ext (items : List Wire) : Wire :=
  .object [("version", .string "0.1"), ("firestoreDatabases", .array items)]

def entry (database : String) (path : String) : Wire :=
  .object [("database", .string database), ("path", .string path)]

def good : Wire := .object [("path", .string "data")]

def manifestSpecial : List Wire :=
  [ .array [], .object [("firestore", .other)], .object [("version", .other)],
    root [("firestore", .other)], root [("fireemu", .other)],
    root [("fireemu", ext [.other])], root [("fireemu", ext [entry "(default)" "data"])],
    root [("fireemu", ext [entry "" "data"])], root [("fireemu", ext [entry "ok" "/abs"])],
    root [("fireemu", ext [entry "beta" "data/b", entry "alpha" "data/a"])],
    root [("auth", good), ("dataconnect", good), ("database", good),
      ("firestore", good), ("storage", good), ("unknown", .other)],
    root [("auth", .other), ("database", good), ("firestore", .object []), ("fireemu", .other)],
    root [("fireemu", .object [("firestoreDatabases", .other), ("version", .other)])],
    root [("storage", .object [("path", .string "./ok//data"), ("metadata_file", .string "data/.")])] ]

def sizes : List (String × List (String × Wire)) :=
  [("missing", []), ("int", [("size", .int 37)]), ("str", [("size", .string "+010")]),
    ("max", [("size", .string "18446744073709551615")]),
    ("overflow", [("size", .string "18446744073709551616")]),
    ("negative", [("size", .int (-1))]), ("fraction", [("size", .number "3.0")])]

def tokenCases : List (String × List (String × Wire)) :=
  [("missing", []), ("array", [("downloadTokens", .array [.string "a", .string "b"])]),
    ("joined", [("downloadTokens", .string "a,,b,")]),
    ("wrongArray", [("downloadTokens", .array [.string "a", .int 5])]),
    ("ignored", [("downloadTokens", .other)])]

def customCases : List (String × List (String × Wire)) :=
  [("missing", []), ("valid", [("customMetadata", .object [("z", .string "last"), ("a", .string "first")])]),
    ("wrong", [("customMetadata", .object [("z", .other), ("a", .int 9)])]),
    ("ignored", [("customMetadata", .other)])]

def objectRow (labels : List String) (value : Wire) :=
  row "storage" labels value ((object value).map ObjectProjection.signature)

def objectMatrix : List String :=
  sizes.flatMap fun (size, sizeFields) =>
    tokenCases.flatMap fun (tokens, tokenFields) =>
      customCases.map fun (custom, customFields) =>
        let value := Wire.object ([("name", .string "object"), ("bucket", .string "bucket"),
          ("generation", .string "-2"), ("metageneration", .int 7), ("future", .int 99)] ++
          sizeFields ++ tokenFields ++ customFields)
        objectRow [size, tokens, custom, "-"] value

def objectSpecial : List Wire :=
  [.other, .object [], .object [("name", .string "object")],
    .object [("name", .string "object"), ("bucket", .string "bucket"),
      ("generation", .other), ("metageneration", .string "9223372036854775808")],
    .object [("name", .string "object"), ("bucket", .string "bucket"), ("size", .other)]]

def main : IO Unit := do
  let labels := ["curated", "curated", "curated", "curated"]
  let rows := manifestMatrix ++ manifestSpecial.map (manifestRow labels) ++
    objectMatrix ++ objectSpecial.map (objectRow labels)
  IO.println s!"# {rows.length} cases"
  rows.forM IO.println
