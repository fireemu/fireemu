import StorageNames

open StorageNames

/-!
# Golden corpus

A count header followed by TSV rows `id kind hexUtf8 reason`. The strict bucket reason keeps
the exact public wording; object and core bucket errors are disjoint enum tags.
-/

def hexByte (value : UInt8) : String :=
  let digits := "0123456789abcdef".toList.toArray
  String.ofList [digits[value.toNat / 16]!, digits[value.toNat % 16]!]

def hex (text : String) : String :=
  String.join (text.toUTF8.data.toList.map hexByte)

def describe : Option Violation → String
  | none => "ok"
  | some .empty => "empty"
  | some .long => "long"
  | some .control => "control"
  | some .dot => "dot"
  | some .objectReserved => "object-reserved"
  | some .bucketCharacter => "bucket-character"
  | some .strictShort => "a bucket name has at least 3 characters"
  | some .strictLong => "a bucket name has at most 222 characters"
  | some .strictCharacter => "a bucket name uses lowercase letters, digits, '-', '_' and '.' only"
  | some .strictEnds => "a bucket name starts and ends with a letter or a digit"
  | some .strictComponent => "each dot-separated component of a bucket name has 1 to 63 characters"
  | some .strictReserved => "a bucket name does not start with 'goog' or contain 'google'"
  | some .strictIp => "a bucket name is not shaped like an IP address"

inductive Kind where
  | object | bucket | strict

def Kind.label : Kind → String
  | .object => "object"
  | .bucket => "bucket"
  | .strict => "strict"

def Kind.limit : Kind → Nat
  | .object => 1024
  | _ => 222

def Kind.check : Kind → String → Option Violation
  | .object => objectViolation
  | .bucket => bucketViolation
  | .strict => strictViolation

inductive Width where
  | ascii | latin | astral

def Width.label : Width → String
  | .ascii => "ascii"
  | .latin => "latin"
  | .astral => "astral"

def Width.scalar : Width → Char
  | .ascii => 'a'
  | .latin => 'é'
  | .astral => '🌸'

inductive Boundary where
  | empty | min | limit | over

def Boundary.label : Boundary → String
  | .empty => "empty"
  | .min => "min"
  | .limit => "limit"
  | .over => "over"

def Boundary.size (kind : Kind) : Boundary → Nat
  | .empty => 0
  | .min => 3
  | .limit => kind.limit
  | .over => kind.limit + 1

def repeated (width : Width) (size : Nat) : String :=
  let scalar := width.scalar
  let scalarBytes := (String.singleton scalar).utf8ByteSize
  let n := size / scalarBytes
  String.ofList (List.replicate n scalar ++ List.replicate (size % scalarBytes) 'a')

def boundaryText (width : Width) (size : Nat) : String :=
  -- A short nonempty Unicode row still exposes the selected scalar to the grammar. The limit
  -- and over-limit rows have exactly the prescribed number of UTF-8 bytes.
  if size > 0 && size < (String.singleton width.scalar).utf8ByteSize then
    String.singleton width.scalar
  else repeated width size

def kinds : List Kind := [.object, .bucket, .strict]

def row (id : String) (kind : Kind) (text : String) : String :=
  String.intercalate "\t" [id, kind.label, hex text, describe (kind.check text)]

def matrix : List String :=
  kinds.flatMap fun kind => [Width.ascii, .latin, .astral].flatMap fun width =>
    [Boundary.empty, .min, .limit, .over].map fun boundary =>
      row s!"{kind.label}/{width.label}/{boundary.label}" kind
        (boundaryText width (boundary.size kind))

def curated : List (String × String) :=
  [ ("one", "a"), ("two", "ab"), ("minimum", "abc"), ("dot", "."), ("dotdot", "..")
  , ("opaque", "/a/%2F/../"), ("nfc", "café"), ("nfd", "cafe\u0301")
  , ("newline", "a\nb"), ("carriage", "a\rb"), ("null", "a\x00b"), ("tab", "a\tb")
  , ("object-prefix", ".well-known/acme-challenge/token")
  , ("prefix-without-slash", ".well-known/acme-challenge")
  , ("leading", "_abc"), ("trailing", "abc."), ("interior", "a_-b.cd")
  , ("empty-component", "ab..cd"), ("goog", "goog-bucket"), ("google", "a-google-b")
  , ("ipv4", "001.2.3.255"), ("not-ipv4", "1.2.3.256"), ("ipv4-components", "1.2.003.0004")
  , ("length-63", repeated .ascii 63), ("length-64", repeated .ascii 64)
  , ("dotted-max", String.intercalate "." (List.replicate 3 (repeated .ascii 63) ++ [repeated .ascii 30]))
  , ("dotted-over", String.intercalate "." (List.replicate 3 (repeated .ascii 63) ++ [repeated .ascii 31]))
  , ("long-and-control", repeated .ascii 1024 ++ "\x00")
  , ("strict-short-first", "_!"), ("strict-character-first", "_💡.")
  ]

def main : IO Unit := do
  let rows := matrix ++ (kinds.flatMap fun kind => curated.map fun (id, name) => row s!"{kind.label}/{id}" kind name)
  IO.println s!"# {rows.length}"
  rows.forM IO.println
