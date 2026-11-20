import StorageHttpRange

open StorageHttpRange

/-! Each row has an ID, profile, operation, input and expected observation.
A download input is `data|range` and its result is `status|Content-Range|body`.
Upload inputs and observations are semicolon-separated traces and `|` separates fields. -/

def profiles : List (String × Profile) := [("strict", .strict), ("emulator", .emulator)]

def rangeHeader : Range → String
  | .none => "-"
  | .closed first last => s!"bytes={first}-{last}"
  | .openEnd first => s!"bytes={first}-"
  | .suffix n => s!"bytes=-{n}"
  | .malformed header => header

def headerKinds : List (String × Range) :=
  [ ("none", .none), ("partial", .closed 0 1), ("clipped", .closed 0 (2 ^ 64 - 1))
  , ("open", .openEnd 1), ("suffix", .suffix 1), ("suffixzero", .suffix 0), ("past", .openEnd 9)
  , ("reversed", .closed 5 2), ("otherunit", .malformed "items=0-1")
  , ("multiple", .malformed "bytes=0-0,2-2"), ("huge", .malformed "bytes=18446744073709551616-") ]

def downloads : List String :=
  profiles.flatMap fun (profileName, profile) =>
    [("empty", ""), ("one", "0"), ("many", "01234")].flatMap fun (label, content) =>
      headerKinds.map fun (headerName, header) =>
        let (code, contentRange, body) := download profile content header
        String.intercalate "\t" [s!"{profileName}/{label}/{headerName}", profileName, "get",
          s!"{content}|{rangeHeader header}", s!"{code}|{contentRange}|{body}"]

def replyText : Reply → String
  | .incomplete 0 => "308|-|-"
  | .incomplete (n + 1) => s!"308|bytes=0-{n}|-"
  | .finished body => s!"200|-|{body}"
  | .invalid message => s!"400|-|{message}"
  | .closed => "499|-|-"

def requestText (request : UploadRange × String) : String := s!"{uploadHeader request.1}|{request.2}"

def uploadTrace (profileName label : String) (requests : List (UploadRange × String)) : String :=
  let (_, replies) := requests.foldl (fun (session, replies) (header, body) =>
    let (next, reply) := ingest session header body
    (next, replies ++ [replyText reply])) (defaultSession, [])
  String.intercalate "\t" [s!"{profileName}/{label}", profileName, "upload",
    String.intercalate ";" (requests.map requestText), String.intercalate ";" replies]
where
  defaultSession : Session := {}

def statusQuery (total : Option Nat) : UploadRange × String := (.status total, "")

def uploads : List String :=
  profiles.flatMap fun (profileName, _) =>
    let withStatus := fun (chunks : List (UploadRange × String)) total =>
      statusQuery total :: chunks ++ [statusQuery total]
    let matrix :=
      [ ("one/known", withStatus [(.closed 0 3 (some 4), "abcd")] (some 4))
      , ("one/unknown", withStatus [(.openEnd 0 none, "abcd")] none)
      , ("two/known", withStatus [(.closed 0 1 (some 4), "ab"), (.closed 2 3 (some 4), "cd")] (some 4))
      , ("two/unknown", withStatus [(.closed 0 1 none, "ab"), (.openEnd 2 none, "cd")] none) ]
    let examples :=
      [ ("retries", [(.closed 0 1 (some 4), "ab"), (.closed 0 1 (some 4), "AB"),
          (.closed 1 3 (some 4), "Xcd"), statusQuery (some 4), (.closed 0 3 (some 4), "abcd")])
      , ("gap", [(.closed 1 2 (some 4), "bc"), statusQuery none, (.closed 0 3 (some 4), "abcd")])
      , ("body-mismatch", [(.closed 0 3 (some 4), "xy"), statusQuery none, (.closed 0 3 (some 4), "abcd")])
      , ("beyond-total", [(.closed 0 3 (some 3), "abcd"), statusQuery none])
      , ("invalid", [(.closed 3 2 none, ""), (.closed 0 (2 ^ 64 - 1) none, ""),
          (.malformed "items 0-1/2", "ab"), statusQuery none])
      , ("changed-total", [(.closed 0 1 (some 4), "ab"), (.closed 2 3 (some 5), "cd"), statusQuery none])
      , ("absent-header", [(.absent, "abcd"), statusQuery none])
      , ("short-final", [(.closed 0 1 (some 4), "ab"), (.openEnd 2 (some 4), "c"), statusQuery none])
      , ("long-final", [(.openEnd 0 (some 2), "abc"), statusQuery none])
      , ("empty", [(.openEnd 0 none, ""), statusQuery none]) ]
    (matrix ++ examples).map fun (label, steps) => uploadTrace profileName label steps

def main : IO Unit := do
  let rows := downloads ++ uploads
  IO.println s!"# {rows.length}"
  rows.forM IO.println
