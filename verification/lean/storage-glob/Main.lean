import StorageGlob

open StorageGlob

/-!
# Golden corpus

A count header followed by TSV rows `id mode pattern name expected`. Empty fields represent
empty strings. Matrix row IDs encode the PICT atom, literal prefix and subject tail factors.
-/

def render : Atom → String
  | .literal c => if ['*', '?', '[', '{', '}', ',', '\\'].contains c then
      "\\" ++ String.singleton c else String.singleton c
  | .question => "?"
  | .segmentStar => "*"
  | .recursiveStar => "**"
  | .directoryStar => "**/"
  | .class ranges negated =>
    (if negated then "[!" else "[") ++
    String.join (ranges.map fun (lo, hi) =>
      if lo == hi then String.singleton lo else String.ofList [lo, '-', hi]) ++ "]"

def renderBranch (atoms : List Atom) : String := String.join (atoms.map render)

def matchRow (id : String) (pattern name : String) (expected : Bool) : String :=
  String.intercalate "\t" [id, "match", pattern, name, toString expected]

def sequence (id : String) (atoms : List Atom) (name : String) : String :=
  matchRow id (renderBranch atoms) name (accepts atoms name.toList)

def union (id : String) (headText : List Atom) (branches : List (List Atom)) (name : String) : String :=
  let pattern := renderBranch headText ++ "{" ++ String.intercalate "," (branches.map renderBranch) ++ "}"
  matchRow id pattern name (matchesChoice (branches.map (headText ++ ·)) name.toList)

def flavors : List (String × List Atom) :=
  [ ("literal", [.literal 'x']), ("question", [.question]), ("segment", [.segmentStar])
  , ("recursive", [.recursiveStar]), ("dirs", [.directoryStar])
  , ("range", [.class [('a', 'c'), ('🌸', '🌸')] false])
  , ("negated", [.class [('a', 'c'), ('🌸', '🌸')] true]), ("choice", [])
  , ("escaped", [.literal '*'])
  ]

def prefixes : List (String × String) := [("bare", ""), ("rooted", "prefix/")]

def tails : List (String × String) :=
  [ ("empty", ""), ("one", "x"), ("two", "xx"), ("slash", "/")
  , ("nested", "x/y/"), ("unicode", "🌸"), ("inrange", "b"), ("asterisk", "*")
  ]

def matrix : List String :=
  flavors.flatMap fun (flavor, atoms) => prefixes.flatMap fun (prefixKind, headText) =>
    tails.map fun (tailKind, tail) =>
      let key := s!"{flavor}/{prefixKind}/{tailKind}"
      let prefixAtoms := headText.toList.map Atom.literal
      if flavor == "choice" then
        union key prefixAtoms [[.literal 'x'], [.directoryStar, .literal 'b'], []] (headText ++ tail)
      else
        sequence key (prefixAtoms ++ atoms) (headText ++ tail)

def diagnostic (id headText : String) (shape : Fragment) : String :=
  String.intercalate "\t" [id, "validate", fragmentText headText shape, "", (validation headText shape).getD "ok"]

def repeated (n : Nat) (c : Char) : String := String.ofList (List.replicate n c)

def curated : List String :=
  [ sequence "slash-hidden" [.segmentStar, .literal 'x'] "a/x"
  , sequence "globstar-with-slash" [.recursiveStar, .literal 'x'] "a/x"
  , sequence "skip-directory" [.directoryStar, .literal 'x'] "x"
  , sequence "directory-literal-tail" [.directoryStar, .literal 'x'] "a/x"
  , sequence "directory-nonmatching-tail" [.directoryStar, .literal 'x'] "ax"
  , sequence "literal-trailing" [.literal 'x'] "xx"
  , sequence "literal-leading" [.literal 'x'] "ax"
  , sequence "combining-mark" [.question] "é"
  , sequence "decomposed-vs-nfc" [.literal 'é'] "é"
  , sequence "two-scalars" [.question, .question] "é"
  , sequence "bracket-class-slash" [.class [('/', '/')] false] "/"
  , sequence "colon-range-slash" [.class [('.', ':')] false] "/"
  , sequence "bracket-class-negated" [.class [('x', 'x')] true] "/"
  , sequence "escaped-braces" [.literal '{', .literal ',', .literal '}'] "{,}"
  , union "brace-prefix-mismatch" [.literal 'x'] [[.literal 'y'], []] "y"
  , union "brace-one-step" [.literal 'x'] [[.literal 'y'], []] "xy"
  , diagnostic "empty-pattern" "" .plain
  , diagnostic "class-index" "🌸/é" .unterminatedClass
  , diagnostic "brace-index" "🌸/é" .unterminatedBrace
  , diagnostic "max-pattern" (repeated 256 '🌸') .plain
  , diagnostic "over-pattern" ((repeated 256 '🌸') ++ "a") .plain
  , diagnostic "length-precedes-class" (repeated 256 '🌸') .unterminatedClass
  , diagnostic "length-precedes-brace" (repeated 256 '🌸') .unterminatedBrace
  ]

def main : IO Unit := do
  let rows := matrix ++ curated
  IO.println s!"# {rows.length}"
  rows.forM IO.println
