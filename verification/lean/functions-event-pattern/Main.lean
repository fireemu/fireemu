import FunctionsEventPattern

open FunctionsEventPattern

def families : List (String × String) :=
  [("literal", "users/alice"), ("single", "users/{id}"), ("wild", "users/*"),
   ("multi", "users/{path=**}"), ("starstar", "users/**"),
   ("sorted", "{z}/{a}"), ("collection", "users")]

def shapes : List (String × String) :=
  [("empty", ""), ("prefix", "users"), ("exact", "users/alice"),
   ("deep", "users/alice/posts/日"), ("hole", "users//id"), ("miss", "posts/alice")]

def trims : List String := ["plain", "wrapped"]

def errorCode : ParseError → String
  | .empty => "empty"
  | .multiNotLast => "nonfinal"
  | .malformed segment => s!"malformed={segment}"
  | .duplicate name => s!"duplicate={name}"

def segmentCode : Segment → String
  | .literal s => "literal=" ++ s
  | .wildcard => "single"
  | .multiWildcard => "multi"
  | .capture s => "capture=" ++ s
  | .multiCapture s => "capture-many=" ++ s

def row (id pattern rawPath : String) : String :=
  let output := match parse pattern with
    | .error err => [errorCode err, "-", "-", "-"]
    | .ok p =>
      let result := match captures p rawPath with
        | none => "miss"
        | some found => "match:" ++ String.intercalate "," (found.map (fun (k, v) => k ++ "=" ++ v))
      ["ok", trimSlash pattern, String.intercalate "," (p.map segmentCode),
        (if isDocument p then "document:" else "collection:") ++ result]
  String.intercalate "\t" ([id, pattern, rawPath] ++ output)

def main : IO Unit := do
  let matrix := families.flatMap fun (f, pattern) =>
    shapes.flatMap fun (shape, path) =>
      trims.map fun trim =>
        let wrap (s : String) := if trim == "plain" then s else "//" ++ s ++ "/"
        row s!"{f}/{shape}/{trim}" (wrap pattern) (wrap path)
  let malformed := [("", "empty"), ("///", "slashes"), ("users//{id}", "interior"),
    ("users/{id", "open"), ("users/{}", "blank-name"), ("users/{id=x}", "bad-flag"),
    ("users/{日}", "non-ascii"), ("users/**/id", "nonfinal-wild"), ("{x=**}/id", "nonfinal-capture"),
    ("{x}/{x}", "repeated"), ("{x}/{x=**}/id", "duplicate-before-nonfinal"),
    ("{x}/{x=}/id", "malformed-before-duplicate"), ("a}/{_2}", "literal-and-ascii-name"),
    ("{id}", "empty-path-as-component"), ("{all=**}", "empty-tail-at-root")]
  let rows := matrix ++ malformed.map (fun (pattern, label) => row label pattern "")
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
