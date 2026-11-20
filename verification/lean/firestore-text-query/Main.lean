import FirestoreTextQuery

open FirestoreTextQuery

def anyField (terms : List String) : Clause := ⟨none, terms, false⟩
def excluded (terms : List String) : Clause := ⟨none, terms, true⟩
def restricted (field : String) (terms : List String) : Clause := ⟨some field, terms, false⟩

def queries : List (String × String × Query) :=
  let redFox := [anyField ["red"], anyField ["fox"]]
  [("plain", "red fox", .plain ["red", "fox"]),
    ("reverse", "fox red", .plain ["fox", "red"]),
    ("phrase", "\"red fox\"", .legacy [anyField ["red", "fox"]]),
    ("quotedReverse", "\"fox red\"", .legacy [anyField ["fox", "red"]]),
    ("restricted", "title:\"red fox\"", .legacy [restricted "title" ["red", "fox"]]),
    ("excluded", "red -fox", .legacy [anyField ["red"], excluded ["fox"]]),
    ("connector", "red OR fox", .legacy redFox),
    ("colon", "red:fox", .legacy redFox),
    ("unmatched", "\"red fox", .legacy redFox),
    ("negative", "-red", .legacy [excluded ["red"]]),
    ("unknown", "unindexed:\"red\"", .legacy [restricted "unindexed" ["red"]]),
    ("invalid", "red OR -fox", .syntaxError),
    ("latin", "CAFÉ Straße", .plain ["cafe", "strasse"]),
    ("dotted", "İzmir", .plain [("i" ++ String.singleton (Char.ofNat 0x0307) ++ "zmir")])]

def doc (name : String) (title body : List String) : String × Fields :=
  ("docs/" ++ name, [("title", title), ("body", body)])

/-- Documents here are in expected creation-descending, path-ascending order. The Rust
    replay supplies the reverse input order to storage. -/
def english : List (String × Fields) :=
  [doc "adj" ["blue"] ["red", "fox"], doc "both" ["red", "fox"] ["red"],
    doc "joined" ["redfox"] [], doc "reverse" ["fox", "red"] [],
    doc "sep" ["red", "blue", "fox"] [], doc "split" ["red"] ["fox"], doc "only" ["red"] []]

/-- These tokens pin the directionality only for the selected Latin analyzer examples,
    leaving Unicode normalization beyond that finite corpus outside the model. -/
def latin : List (String × Fields) :=
  [doc "accent" ["cafe", "strasse"] [], doc "folded" ["cafe", "strasse"] [],
    doc "dotted" ["izmir"] []]

def corpus : List (String × List (String × Fields)) :=
  [("english", english), ("latin", latin), ("mixed", english ++ latin)]

def pages : List (String × Option Nat × Nat × Option Nat) :=
  [("all", none, 0, none), ("window", none, 1, some 2),
    ("depth", some 2, 1, some 3), ("empty", none, 0, some 0)]

def main : IO Unit := do
  IO.println "# QUERY CORPUS PAGE TEXT RESULT PATHS, tab separated"
  for (queryCase, input, query) in queries do
    for (corpusCase, docs) in corpus do
      let hits := docs.filterMap fun (name, fields) =>
        if membership ["title", "body"] query fields == .hit then some name else none
      let status := match membership ["title", "body"] query [] with
        | .invalid => "invalid"
        | .unknown => "unknown"
        | _ => "ok"
      for (pageCase, depth, offset, limit) in pages do
        let paths := page hits depth offset limit
        IO.println ("\t".intercalate
          [queryCase, corpusCase, pageCase, input, status,
            if paths.isEmpty then "-" else ",".intercalate paths])
