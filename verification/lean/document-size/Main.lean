import DocumentSize

/-!
# Golden corpus generator

The header declares the number of cases. Each subsequent line has one of the following forms:

    value <value> => <size>
    fields <map> => <size>
    reference <hex UTF-8> => <size>
    name <path> => <size>
    document <path> <map> => <total> <name bytes> <model revision> <precision> <count> [key:<hex UTF-8> <bytes>]...
    indexed <value> => <size>
    index <sc|sg|cc|cg> <path> <path or -> <map> => <size>

Paths are slash-joined segments in hex UTF-8. The index scopes are single-field collection, single-field collection group, composite collection, and composite collection group. The index map supplies the ordered field list. A size is decimal; a refusal is `overflow` (also the sole error for documents).

Values are in prefix form:

* `null`, `bool:0`, `bool:1`, `int`, `dbl`, `ts`, `geo` (fixed representatives for size-independent payloads)
* `str:<hex UTF-8>`, `bytes:<length>`, `ref:<hex UTF-8>`, `vec:<length>` (zero-filled bytes and vectors)
* `arr:<count>` followed by that many values, `map:<count>` followed by that many pairs `key:<hex UTF-8> <value>`

Queries are deterministic products of value and container shapes, paths, and index scopes, with explicit boundary cases.
-/

open DS

def hexDigit (n : Nat) : Char := "0123456789abcdef".toList[n % 16]!

def hex (s : String) : String :=
  String.ofList (s.toUTF8.toList.flatMap fun b => [hexDigit (b.toNat / 16), hexDigit b.toNat])

def encPath (path : Path) : String := hex ("/".intercalate path)

partial def enc : DS.Value → String
  | .null => "null"
  | .boolean false => "bool:0"
  | .boolean true => "bool:1"
  | .integer => "int"
  | .double => "dbl"
  | .timestamp => "ts"
  | .geoPoint => "geo"
  | .string s => s!"str:{hex s}"
  | .bytes n => s!"bytes:{n}"
  | .reference s => s!"ref:{hex s}"
  | .array xs => " ".intercalate (s!"arr:{xs.length}" :: xs.map enc)
  | .vector n => s!"vec:{n}"
  | .map fs =>
    " ".intercalate (s!"map:{fs.length}" :: fs.map (fun (k, v) => s!"key:{hex k} {enc v}"))

def encSize (size : Size) : String := (size.map toString).getD "overflow"

def encDocument : Option Breakdown → String
  | none => "overflow"
  | some d => " ".intercalate
    (s!"{d.total} {d.nameBytes} {d.modelRevision} {d.precision} {d.largestContributors.length}" ::
      d.largestContributors.map (fun (k, n) => s!"key:{hex k} {n}"))

def repeatChar (c : Char) (n : Nat) : String := String.ofList (List.replicate n c)

def resourcePrefix : String := "projects/demo-app/databases/(default)/documents/"

def references : List String := [
  "", "/", "c/0007", "c/-12", "a//b/", "/documents/c/d", "projects/p/documents/c/d",
  "projects/p/databases/d", "projects/documents/databases/documents/documents/c/0001",
  "projects/p/databases/d/documents/a/documents/b/", "projects/p/databases/d/documents/",
  resourcePrefix ++ "種別/🐈", resourcePrefix ++ "c/" ++ repeatChar 'x' 1481,
  resourcePrefix ++ "c/" ++ repeatChar 'x' 1482, resourcePrefix ++ "c/" ++ repeatChar 'x' 1483,
  resourcePrefix ++ "c/" ++ repeatChar 'é' 1000]

def nest (wrap : DS.Value → DS.Value) (base : DS.Value) : Nat → DS.Value
  | 0 => base
  | n + 1 => wrap (nest wrap base n)

def values : List DS.Value :=
  [.null, .boolean false, .boolean true, .integer, .double, .timestamp, .geoPoint,
    .array [], .map [], .map [("", .null), ("é", .bytes 0), ("是🐈", .string "λ")],
    .array [.null, .array [], .map []]] ++
  (["", "x", "a\x00b", "é", "é", "猫", "🐈", "a b\n猫", repeatChar 'a' 1498,
    repeatChar 'a' 1499, repeatChar 'a' 1500, repeatChar 'é' 750].map DS.Value.string) ++
  ([0, 1, 255, 1499, 1500, 1501, 65536].map DS.Value.bytes) ++
  ([0, 1, 187, 188, 2048].map DS.Value.vector) ++
  references.map DS.Value.reference ++
  ((List.range 21).flatMap fun depth =>
    [nest (fun v => .array [v]) (.bytes 0) depth,
      nest (fun v => .map [("猫", v)]) .null depth,
      nest (fun v => .array [.boolean true, .map [("é", v)]])
        (if depth % 2 == 0 then .string "🐈" else .map [("", .string "🐈")]) (depth / 2)])

def paths : List Path :=
  [["c", "d"], ["種別", "🐈", "sub", "0001"], ["numeric", "-007"], ["x", repeatChar 'z' 1500],
    (List.replicate 100 ["c", "d"]).flatten]

def documents : List Fields :=
  [[], [("", .null)], [("é", .string "猫"), ("🐈", .array [.vector 3, .bytes 2])],
    ("abcdefghijklm".toList.map fun c => (String.singleton c, .null)) ++ [("z", .bytes 42)],
    [("a", .bytes 1), ("b", .bytes 31), ("c", .null), ("d", .bytes 31)]]

def scopes : List (String × Scope) :=
  [("sc", .singleCollection), ("sg", .singleGroup), ("cc", .compositeCollection), ("cg", .compositeGroup)]

def cases : List String :=
  (values.flatMap fun v => [
    s!"value {enc v} => {encSize (fieldValueSize v)}",
    s!"indexed {enc v} => {encSize (indexedValueSize v)}"]) ++
  (references.map fun s => s!"reference {hex s} => {encSize (referenceSize s)}") ++
  (documents.map fun fs => s!"fields {enc (.map fs)} => {encSize (fieldsSize fs)}") ++
  (paths.flatMap fun path =>
    s!"name {encPath path} => {encSize (documentNameSize path)}" ::
    documents.map (fun fs => s!"document {encPath path} {enc (.map fs)} => {encDocument (documentSize path fs)}")) ++
  ([1048521, 1048522, 1048523].map fun n =>
    let fs := [("b", DS.Value.bytes n)]
    let path := ["c", "d"]
    s!"document {encPath path} {enc (.map fs)} => {encDocument (documentSize path fs)}") ++
  (scopes.flatMap fun (tag, scope) =>
    [(["c", "d"], none), (["c", "d", "子", "0"], some ["c", "d"])].flatMap fun (path, parent) =>
      ([[], [("", .null)], [("猫", .bytes 1499)], [("猫", .bytes 1500)], [("猫", .bytes 1501)],
        [("a", .reference (resourcePrefix ++ "c/" ++ repeatChar 'x' 1500)), ("b", .bytes 1800)],
        [("a", .bytes 0), ("a", .vector 188)], [("b", .geoPoint), ("a", .array [.bytes 1530])]].map fun fs =>
          s!"index {tag} {encPath path} {(parent.map encPath).getD "-"} {enc (.map fs)} => {encSize (indexEntrySize scope path parent fs)}"))

def main : IO Unit := do
  IO.println s!"# {cases.length} cases. Generated by verification/lean/document-size (lake exe corpus). Format: see Main.lean."
  for line in cases do IO.println line
