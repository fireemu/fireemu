import Std

namespace UIR

abbrev Params := List (String × String)

structure Refusal where
  code : Nat
  message : String

abbrev Result (α : Type) := Except Refusal α

def invalid (message : String) : Result α := .error ⟨400, message⟩

def lookup (fields : Params) (key : String) : Option String :=
  (fields.find? (fun field => field.1 == key)).map Prod.snd

def hexDigit (character : Char) : Option Nat :=
  if '0' ≤ character && character ≤ '9' then some (character.toNat - '0'.toNat)
  else if 'a' ≤ character && character ≤ 'f' then some (10 + character.toNat - 'a'.toNat)
  else if 'A' ≤ character && character ≤ 'F' then some (10 + character.toNat - 'A'.toNat)
  else none

/-- Each percent escape contributes exactly one byte. Literal plus is an ordinary UTF-8 byte. -/
def urlBytes : List Char → Option (List UInt8)
  | [] => some []
  | '%' :: hi :: lo :: rest => do
    let a ← hexDigit hi
    let b ← hexDigit lo
    let suffix ← urlBytes rest
    return UInt8.ofNat (16 * a + b) :: suffix
  | '%' :: _ => none
  | character :: rest => do
    let suffix ← urlBytes rest
    return (String.singleton character).toUTF8.data.toList ++ suffix

def decode (part : List Char) : Result String :=
  match urlBytes part with
  | none => invalid "Malformed query escape"
  | some bytes =>
    match String.fromUTF8? ⟨bytes.toArray⟩ with
    | none => invalid "Invalid UTF-8 in query"
    | some value => .ok value

def asciiControl (text : String) : Bool :=
  text.toList.any fun c => c.toNat < 32 || c.toNat == 127

def splitPair (pair : String) : List Char × List Char :=
  let left := pair.toList.takeWhile (· != '=')
  (left, pair.toList.drop (left.length + 1))

def parameters (text : String) : Result Params := do
  if (urlBytes text.toList).isNone then
    return ← invalid "Malformed query escape"
  let pieces := (text.splitOn "&").filter (fun s => !s.isEmpty)
  let result ← pieces.foldlM (init := []) fun (fields : Params) piece => do
    let (left, right) := splitPair piece
    let key ← decode left
    let value ← decode right
    if asciiControl key || asciiControl value || (lookup fields key).isSome then
      return ← invalid "Ambiguous or invalid query"
    return (key, value) :: fields
  return result.mergeSort (fun a b => a.1 ≤ b.1)

def isLowerAscii (c : Char) : Bool := 'a' ≤ c && c ≤ 'z'
def isUpperAscii (c : Char) : Bool := 'A' ≤ c && c ≤ 'Z'
def isDigitAscii (c : Char) : Bool := '0' ≤ c && c ≤ '9'

def validName (name : String) : Bool :=
  match name.toList with
  | [] => false
  | first :: _ =>
    (isLowerAscii first || isDigitAscii first) &&
      name.toList.all (fun c => isLowerAscii c || isDigitAscii c || c == '-')

def projectOf (configured : Params) (daemon name : String) : String :=
  match lookup configured name with
  | some owner => owner
  | none =>
    let suffix := "-default-rtdb"
    if name.endsWith suffix && name.length > suffix.length
    then (name.dropEnd suffix.length).toString
    else daemon

def hexUpper (n : Nat) : Char :=
  ("0123456789ABCDEF".toList[n]?).getD '0'

def encode (value : String) : String :=
  String.ofList (value.toUTF8.data.toList.flatMap fun byte =>
    let c := Char.ofNat byte.toNat
    if isLowerAscii c || isUpperAscii c || isDigitAscii c || ['-', '_', '.', '~'].contains c
    then [c] else ['%', hexUpper (byte.toNat / 16), hexUpper (byte.toNat % 16)])

def badPath (path : String) : Bool :=
  path.toList.any (fun c =>
    ['.', '#', '$', '[', ']'].contains c || c.toNat < 32 || (127 ≤ c.toNat && c.toNat ≤ 159)) ||
      (path.splitOn "//").length > 1

def trimSlashes (path : String) : String :=
  let first := path.toList.dropWhile (· == '/')
  String.ofList (first.reverse.dropWhile (· == '/')).reverse

def dataTarget (path : String) : String :=
  "/" ++ String.intercalate "/" (((trimSlashes path).splitOn "/").map encode) ++ ".json"

def queryKeys : List String :=
  ["orderBy", "startAt", "endAt", "equalTo", "limitToFirst", "limitToLast", "shallow",
    "format", "print", "writeSizeLimit", "timeout"]

def dataQuery (nested : Option String) : Result String :=
  match nested with
  | none => .ok ""
  | some text => do
    let fields ← parameters text
    if fields.any (fun kv => !queryKeys.contains kv.1) then
      return ← invalid "Unsupported data query parameter"
    return String.join (fields.map (fun (k, v) => "&" ++ encode k ++ "=" ++ encode v))

def actionKeys : List String := ["instances", "data", "rules", "request"]

def allowedMethod (action method : String) : Bool :=
  let allowed := if action == "instances" then ["GET"]
    else if action == "rules" then ["GET", "PUT"]
    else ["GET", "PUT", "PATCH", "DELETE"]
  allowed.contains method

def ownerPrivilege (action : String) : Bool := action != "request"

structure Input where
  action : String
  method : String
  query : String
  bodyLength : Nat

structure Endpoint where
  daemon : String
  configured : Params

structure Plan where
  session : String
  project : String
  databaseName : Option String
  target : String
  administrator : Bool

def maxBody : Nat := 256 * 1024

def field (fields : Params) (key message : String) : Result String :=
  match lookup fields key with
  | some found => .ok found
  | none => invalid message

def prepare (endpoint : Endpoint) (sessions : Params) (input : Input) : Result Plan := do
  if input.bodyLength > maxBody then return ← .error ⟨413, "PAYLOAD_TOO_LARGE"⟩
  let fields ← parameters input.query
  if fields.any (fun (key, _) =>
      !(["session", "project", "namespace", "path", "query"].contains key)) then
    return ← invalid "Unsupported request parameter"
  let session ← field fields "session" "Session is required"
  let project ← field fields "project" "Project is required"
  if lookup sessions session != some project then
    return ← .error ⟨404, "The session/project no longer exists"⟩
  if !actionKeys.contains input.action then return ← .error ⟨404, "NOT_FOUND"⟩
  if !allowedMethod input.action input.method then
    return ← .error ⟨405, "METHOD_NOT_ALLOWED"⟩
  if input.action == "instances" then
    if fields.length != 2 || input.bodyLength != 0 then
      return ← invalid "Only session/project are allowed for instance listing"
    return ⟨session, project, none, "", true⟩
  let databaseName ← field fields "namespace" "Invalid database instance"
  if !validName databaseName then return ← invalid "Invalid database instance"
  if projectOf endpoint.configured endpoint.daemon databaseName != project then
    return ← .error ⟨404, "Instance does not belong to the selected project"⟩
  let path ← if input.action == "rules" then
    if (lookup fields "path").isSome || (lookup fields "query").isSome then
      invalid "Rules target is fixed"
    else pure "/.settings/rules.json"
  else
    let dataPath := (lookup fields "path").getD "/"
    if badPath dataPath then invalid "Invalid database path" else pure (dataTarget dataPath)
  let extra ← dataQuery (lookup fields "query")
  if ["GET", "DELETE"].contains input.method && input.bodyLength != 0 then
    return ← invalid "This method does not accept a body"
  return ⟨session, project, some databaseName, path ++ "?ns=" ++ encode databaseName ++ extra,
    ownerPrivilege input.action⟩

def loopback (v6 : Bool) (port : Nat) : String :=
  (if v6 then "[::1]:" else "127.0.0.1:") ++ toString port

end UIR
