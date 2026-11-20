import FunctionsEnv

open FunctionsEnv

def hex (s : String) : String :=
  let digits := "0123456789abcdef".toList.toArray
  String.ofList (s.toUTF8.data.toList.flatMap (fun byte => [digits[byte.toNat / 16]!, digits[byte.toNat % 16]!]))

def encodePairs (pairs : List (String × String)) : String :=
  String.intercalate "," (pairs.map (fun (k, v) => hex k ++ "=" ++ hex v))

def quotes : List (String × Quote) := [("bare", .bare), ("single", .single), ("double", .double)]

def bodies : List (String × String) :=
  [("plain", " spaced value "), ("hash", "before#after"), ("escapes", "a\\n\\t\\v\\r\\\\\\q日")]

def endings : List (String × String) := [("lf", "\n"), ("crlf", "\r\n"), ("cr", "\r")]

def render (quote : Quote) (s : String) : String :=
  match quote with
  | .bare => s
  | .single => "'" ++ s ++ "'"
  | .double => "\"" ++ s ++ "\""

def keyRow (id key : String) : String :=
  let result := match validate key with
    | .ok _ => "-"
    | .error error => hex (keyMessage key error)
  String.intercalate "\t" [id, "key", hex key, result]

def fileRow (id project : String) (alias : Option String) : String :=
  String.intercalate "\t" [id, "files", hex project,
    alias.map hex |>.getD "-", String.intercalate "," (fileOrder project alias)]

def valueRow (id : String) (quote : Quote) (body newline : String) : String :=
  let source := String.intercalate newline
    ["# a dotenv fixture", "A=earlier", "B=unchanged", "export A = " ++ render quote body]
  let assignments := [("A", "earlier"), ("B", "unchanged"), ("A", value quote body)]
  let expected := ["A", "B"].map (fun key => (key, (readAssignment key assignments).getD ""))
  String.intercalate "\t" [id, "strict", hex source, "ok", encodePairs expected]

def refusal (id source message : String) : String :=
  String.intercalate "\t" [id, "strict", hex source, "error", hex message]

def main : IO Unit := do
  let combinations := quotes.flatMap fun (name, quote) =>
    bodies.flatMap fun (style, body) =>
      endings.map fun (ending, newline) =>
        valueRow s!"{name}/{style}/{ending}" quote body newline
  let keys := reservedKeys ++ (prefixes.map (· ++ "SETTING")) ++
    exceptions ++ (exceptions.map (· ++ "1")) ++
    ["", "_", "A", "PORT_1", "a", "A_b", "1A", "A/1", "KIT_setting", "FIREBASE_日", "É", "A.B"]
  let keyRows := keys.zipIdx |>.map (fun (key, i) => keyRow s!"key{i}" key)
  let rows := combinations ++ keyRows ++
    [fileRow "without-alias" "demo-project" none, fileRow "with-alias" "demo-project" (some "staging"),
     refusal "bad-line-before-keys" "PORT=123\n bad line \r\n?" "Invalid dotenv file, error on lines: bad line,?",
     refusal "reserved-and-shape" "z=bad\nPORT=0"
       s!"Validation failed: Failed to validate key PORT: {keyMessage "PORT" .exact}; Failed to validate key z: {keyMessage "z" .shape}",
     String.intercalate "\t" ["multiline", "strict", hex "A=\"first\r\nline\"\nB=ok", "ok",
       encodePairs [("A", "first\nline"), ("B", "ok")]]]
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
