import Std

namespace EM

/-- Typed members for the manifest and metadata subset. A numeric-only payload
retains its JSON spelling, so an integer and a fraction remain distinct. -/
inductive Wire where
  | string (text : String)
  | int (number : Int)
  | number (spelling : String)
  | other
  | object (fields : List (String × Wire))
  | array (items : List Wire)
  deriving Inhabited

def quote (text : String) : String :=
  "\"" ++ (text.replace "\\" "\\\\").replace "\"" "\\\"" ++ "\""

partial def render : Wire → String
  | .string text => quote text
  | .int n => toString n
  | .number s => s
  | .other => "false"
  | .object fields => "{" ++ String.intercalate "," (fields.map
      (fun (key, item) => quote key ++ ":" ++ render item)) ++ "}"
  | .array items => "[" ++ String.intercalate "," (items.map render) ++ "]"

def Wire.get (object : Wire) (key : String) : Option Wire :=
  match object with
  | .object fields => (fields.reverse.find? (fun entry => entry.1 == key)).map Prod.snd
  | _ => none

def Wire.asString : Wire → Option String
  | .string s => some s
  | _ => none

def Wire.text (w : Wire) (key : String) := (w.get key).bind Wire.asString

def required (maybe : Option α) (err : String) : Except String α :=
  match maybe with
  | some value => .ok value
  | none => .error err

def productOrder : List String := ["firestore", "database", "auth", "storage", "dataconnect"]

def relative (path : String) : Bool :=
  !path.startsWith "/" && !(path.splitOn "/").contains ".."

def directory (path : String) : Option String :=
  if !path.isEmpty && relative path then some path else none

structure Section where
  version : String
  path : String
  metadataFile : Option String

def Section.signature (item : Section) : String :=
  let marker := item.metadataFile.map (fun text => "+" ++ text)
  item.version ++ "~" ++ item.path ++ "~" ++ marker.getD "-"

def parseSection (name : String) (value : Wire) : Except String Section :=
  let messageStart := "the " ++ name ++ " section of the export manifest "
  match value with
  | .object _ => do
    let path ← required (value.text "path") (messageStart ++ "has no string \"path\"")
    let path ← required (directory path)
      (messageStart ++ "names the path " ++ quote path ++ ", which is not inside the export directory")
    let version := (value.text "version").getD ""
    let metadata ← match value.get "metadata_file" with
      | none => pure none
      | some (.string filename) =>
        if relative filename then pure (some filename)
        else throw (messageStart ++ "names the metadata file " ++ quote filename ++
          ", which is not inside the export directory")
      | some _ => throw (messageStart ++ "has a non-string \"metadata_file\"")
    return ⟨version, path, metadata⟩
  | _ => throw (messageStart ++ "is not an object")

def namedDatabase (value : Wire) : Except String (String × Section) := do
  let name ← required (value.text "database")
    "a fireemu.firestoreDatabases entry has no string \"database\""
  if name.isEmpty || name == "(default)" then
    throw ("the fireemu section names the database " ++ quote name ++
      ", which belongs in the official firestore section")
  let item ← parseSection "firestore" value
  return (name, item)

structure Extension where
  version : String
  named : List (String × Section)

def extension (value : Wire) : Except String Extension :=
  match value with
  | .object _ => do
    let items ← match value.get "firestoreDatabases" with
      | some (.array items) => items.mapM namedDatabase
      | _ => pure []
    return ⟨(value.text "version").getD "", items⟩
  | _ => throw "the fireemu section of the export manifest is not an object"

structure Manifest where
  version : String
  sections : List (String × Section)
  extension : Option Extension

def manifest (value : Wire) : Except String Manifest :=
  match value with
  | .object _ => do
    let version ← required (value.text "version") "the export manifest has no string \"version\""
    let sections ← productOrder.mapM fun product =>
      match value.get product with
      | none => pure none
      | some value => do
        let item ← parseSection product value
        pure (some (product, item))
    let extension ← (value.get "fireemu").mapM extension
    return ⟨version, sections.filterMap id, extension⟩
  | _ => throw "the export manifest is not a JSON object"

def keyed (entries : List (String × Section)) : String :=
  String.intercalate "," (entries.map (fun (key, item) => key ++ ":" ++ item.signature))

def Manifest.signature (value : Manifest) : String :=
  let deferred := (value.sections.map Prod.fst).filter (fun x => x == "dataconnect")
  let extra := value.extension.map fun e => "+" ++ e.version ++ ":" ++ keyed e.named
  String.intercalate ";" [value.version, keyed value.sections,
    String.intercalate "," deferred, extra.getD "-"]

def decimal (text : String) : String :=
  if text.startsWith "+" then String.ofList (text.toList.drop 1) else text

def parseSize (value : Wire) (name : String) : Except String Nat :=
  match value.get "size" with
  | none => .ok 0
  | some (.int n) =>
    if n ≥ 0 then .ok n.toNat
    else .error ("the Storage object " ++ quote name ++ " has a size that is not a whole number")
  | some (.string n) => do
    let candidate := (decimal n).toNat?
    required (candidate.filter (fun n => n < 2 ^ 64))
      ("the Storage object " ++ quote name ++ " has a non-numeric size")
  | _ => .error ("the Storage object " ++ quote name ++ " has a size that is not a whole number")

def joinedTokens (text : String) : List String :=
  (text.splitOn ",").filter (fun item => !item.isEmpty)

def tokens (value : Wire) (name : String) : Except String (List String) :=
  match value.get "downloadTokens" with
  | some (.array items) => items.mapM fun item =>
      required item.asString ("the Storage object " ++ quote name ++ " has a non-string download token")
  | some (.string joined) => .ok (joinedTokens joined)
  | _ => .ok []

def custom (value : Wire) (name : String) : Except String (List (String × String)) :=
  match value.get "customMetadata" with
  | some (.object entries) =>
    (entries.mergeSort (fun a b => a.1 ≤ b.1)).mapM fun (key, value) => do
      let item ← required value.asString ("the Storage object " ++ quote name ++
        " has a non-string customMetadata value for " ++ quote key)
      return (key, item)
  | _ => .ok []

def readGeneration (w : Wire) (key : String) : Int :=
  match w.get key with
  | some (.int n) => n
  | some (.string n) => (((decimal n).toInt?).filter
      (fun x => -(2 ^ 63 : Int) ≤ x && x < (2 ^ 63 : Int))).getD 1
  | _ => 1

def known : List String :=
  ["name", "bucket", "size", "generation", "metageneration", "downloadTokens", "customMetadata"]

structure ObjectProjection where
  name : String
  bucket : String
  size : Nat
  generation : Int
  metageneration : Int
  tokens : List String
  custom : List (String × String)
  extras : List (String × Wire)

def object (w : Wire) : Except String ObjectProjection :=
  match w with
  | .object entries => do
    let name ← required (w.text "name") "a Storage object metadata document has no string \"name\""
    let bucket ← required (w.text "bucket") ("the Storage object " ++ quote name ++ " names no \"bucket\"")
    let size ← parseSize w name
    let tokens ← tokens w name
    let custom ← custom w name
    let extras := (entries.filter (fun entry => !known.contains entry.1))
      |>.mergeSort (fun a b => a.1 ≤ b.1)
    return ⟨name, bucket, size, readGeneration w "generation",
      readGeneration w "metageneration", tokens, custom, extras⟩
  | _ => throw "a Storage object metadata document is not a JSON object"

def writtenSize (size : Nat) : Nat :=
  if size < 2 ^ 63 then size else 0

def ObjectProjection.signature (v : ObjectProjection) : String :=
  let custom := v.custom.map fun (k, x) => k ++ "=" ++ x
  let extras := v.extras.map fun (k, x) => k ++ "=" ++ render x
  String.intercalate ";" [v.name, v.bucket, toString v.size,
    toString v.generation, toString v.metageneration, String.intercalate "," v.tokens,
    String.intercalate "," custom, String.intercalate "," extras, toString (writtenSize v.size)]

end EM
