import StorageListPages

open StorageListPages

/-! A TSV row names the paging arguments, input marker and expected pages. Each page combines
the item sequence, the common prefixes and the continuation point. Repeated name writes in
the fixed snapshot are all retained in versioned mode. -/

def modeTag : Mode → String
  | .gcs => "gcs" | .strict => "strict" | .trailing => "trailing"
  | .firebase => "firebase" | .versions => "versions"

def names : List String :=
  ["z", "a/z", "a/a", "a/", "a/a", "a//y", "a--b", "a----c", "A", "a/é", "a/🌸", "aa", "é", "é", "a--"]

def snapshot : List Version :=
  names.zipIdx |>.map fun (name, i) => ⟨name, i + 1, !(names.drop (i + 1)).contains name⟩

def keyText : Key → String
  | .item name none => name
  | .item name (some generation) => s!"{name}@{generation}"
  | .commonPrefix name => name

def markerText (mode : Mode) (marker : Option Key) : String :=
  match marker with
  | none => "-"
  | some (.commonPrefix name) => if mode = .versions then s!"p:{name}" else name
  | some (.item name (some generation)) => s!"i:{name}@{generation}"
  | some (.item name none) => name

def itemText (obj : Version) : String :=
  let lifecycle := if obj.live then "l" else "a"
  s!"{obj.name}@{obj.generation}:{lifecycle}"

def itemOf (mode : Mode) : Key → Option Version
  | .item name (some generation) => snapshot.find? fun obj => obj.name == name && obj.generation == generation
  | .item name none => snapshot.find? fun obj => obj.name == name && obj.live
  | .commonPrefix name =>
    if mode = .trailing then snapshot.find? fun obj => obj.name == name && obj.live else none

def folderOf : Key → Option String
  | .commonPrefix name => some name
  | .item _ _ => none

def showPage (mode : Mode) (keys : List Key) (next : Option Key) : String :=
  String.intercalate "|" [String.intercalate "," ((keys.filterMap (itemOf mode)).map itemText),
    String.intercalate "," (keys.filterMap folderOf), markerText mode next]

def trace (mode : Mode) (search delimiter : String) (limit : Nat) : Nat → Option Key → List String
  | 0, _ => []
  | fuel + 1, marker =>
    let keys := startAt (ordered snapshot mode search delimiter) mode search marker
    let (page, rest) := cut limit keys
    let next := nextKey mode page rest
    let expected := showPage mode page next
    match next with
    | none => [expected]
    | some key => expected :: trace mode search delimiter limit fuel (some key)

def exampleRow (id : String) (mode : Mode) (search delimiter : String) (limit : Nat)
    (marker : Option Key := none) : String :=
  String.intercalate "\t" [id, modeTag mode, search, delimiter, toString limit, markerText mode marker,
    String.intercalate ";" (trace mode search delimiter limit (snapshot.length + 1) marker)]

def matrix : List String :=
  [Mode.gcs, .strict, .trailing, .firebase, .versions].flatMap fun mode =>
    [("root", ""), ("nested", "a/"), ("absent", "no")].flatMap fun (prefixKind, search) =>
      [("none", ""), ("slash", "/"), ("double", "--")].flatMap fun (delimiterKind, delimiter) =>
        [("one", 1), ("two", 2), ("wide", 80)].map fun (limitKind, limit) =>
          exampleRow s!"{modeTag mode}/{prefixKind}/{delimiterKind}/{limitKind}" mode search delimiter limit

def examples : List String :=
  [ exampleRow "marker/gcs-unknown" .gcs "" "/" 1 (some (.item "a/a0" none))
  , exampleRow "marker/strict-unknown" .strict "" "/" 1 (some (.item "a/a0" none))
  , exampleRow "marker/firebase-unknown" .firebase "" "/" 1 (some (.item "a/a0" none))
  , exampleRow "marker/strict-outside" .strict "a/" "/" 2 (some (.item "bb" none))
  , exampleRow "marker/firebase-past" .firebase "a/" "/" 2 (some (.item "bb" none))
  , exampleRow "marker/gcs-folder" .gcs "" "/" 2 (some (.commonPrefix "a/"))
  , exampleRow "marker/versions-generation" .versions "a/" "" 1 (some (.item "a/a" (some 5)))
  ]

def main : IO Unit := do
  IO.println s!"# {matrix.length + examples.length}"
  (matrix ++ examples).forM IO.println
