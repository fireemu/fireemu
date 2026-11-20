import Std

namespace StorageGlob

inductive Atom where
  | literal (c : Char)
  | question
  | segmentStar
  | recursiveStar
  | directoryStar
  | class (ranges : List (Char × Char)) (negated : Bool)
  deriving Repr

def nonSlash (c : Char) : Bool := c != '/'

def classContains (ranges : List (Char × Char)) (c : Char) : Bool :=
  ranges.any (fun (lo, hi) => lo ≤ c && c ≤ hi)

def consumes : Atom → List Char → Bool
  | .literal c, chars => chars == [c]
  | .question, [c] => nonSlash c
  | .class ranges negated, [c] => nonSlash c && (classContains ranges c != negated)
  | .segmentStar, chars => chars.all nonSlash
  | .recursiveStar, _ => true
  | .directoryStar, chars => chars.isEmpty || chars.getLast? == some '/'
  | _, _ => false

/-- A reference recognizer by splitting a name into an accepted prefix per atom. -/
def accepts : List Atom → List Char → Bool
  | [], name => name.isEmpty
  | atom :: rest, name =>
    (List.range (name.length + 1)).any fun i =>
      consumes atom (name.take i) && accepts rest (name.drop i)

/-- A brace group is a union of alternative sequences. -/
def matchesChoice (alternatives : List (List Atom)) (name : List Char) : Bool :=
  alternatives.any (fun atoms => accepts atoms name)

inductive Fragment where
  | plain
  | unterminatedClass
  | unterminatedBrace
  deriving Repr

def fragmentText (headText : String) : Fragment → String
  | .plain => headText
  | .unterminatedClass => headText ++ "[a"
  | .unterminatedBrace => headText ++ "{a,b"

/-- Admission for the diagnostic fragment: a literal prefix followed by one optional unfinished construct. -/
def validation (headText : String) (shape : Fragment) : Option String :=
  let size := (fragmentText headText shape).utf8ByteSize
  let index := headText.length
  if size > 1024 then
    some s!"Maximum length of the glob pattern is 1024 bytes in UTF-8 encoding, but glob was {size} bytes long."
  else match shape with
    | .plain => none
    | .unterminatedClass =>
      some s!"Glob pattern character class has no closing ']' for opening '[' at index {index}. Either add a closing ']' or use '\\[' to match a literal '['."
    | .unterminatedBrace =>
      some ("Glob pattern brace expansion opening '{' at index " ++ toString index ++
        " has no closing '}'. Use '\\{' to match a literal '{'.")

end StorageGlob
