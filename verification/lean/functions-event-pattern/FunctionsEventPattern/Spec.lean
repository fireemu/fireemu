import Std

namespace FunctionsEventPattern

inductive Segment where
  | literal (text : String)
  | wildcard
  | multiWildcard
  | capture (name : String)
  | multiCapture (name : String)
  deriving Repr, DecidableEq

inductive ParseError where
  | empty
  | multiNotLast
  | malformed (segment : String)
  | duplicate (name : String)
  deriving Repr, DecidableEq

def trimSlash (s : String) : String :=
  String.ofList (((s.toList.dropWhile (· == '/')).reverse.dropWhile (· == '/')).reverse)

def isMulti : Segment → Bool
  | .multiWildcard | .multiCapture _ => true
  | _ => false

def captureName : Segment → Option String
  | .capture name | .multiCapture name => some name
  | _ => none

def asciiNameChar (c : Char) : Bool :=
  ('a' ≤ c && c ≤ 'z') || ('A' ≤ c && c ≤ 'Z') ||
  ('0' ≤ c && c ≤ '9') || c == '_'

def named (part name : String) (multi : Bool) : Except ParseError Segment :=
  if name.isEmpty || !name.toList.all asciiNameChar then .error (.malformed part)
  else .ok (if multi then .multiCapture name else .capture name)

def parseSegment (part : String) : Except ParseError Segment :=
  if part.isEmpty then .error .empty
  else if part == "*" then .ok .wildcard
  else if part == "**" then .ok .multiWildcard
  else if part.startsWith "{" then
    if part.endsWith "}" then
      let body := String.ofList ((part.toList.drop 1).dropLast)
      match body.splitOn "=" with
      | [name] => named part name false
      | [name, "**"] => named part name true
      | _ => .error (.malformed part)
    else .error (.malformed part)
  else .ok (.literal part)

def parseParts (seen : List String) : List String → Except ParseError (List Segment)
  | [] => .ok []
  | part :: rest => do
      let seg ← parseSegment part
      let name := captureName seg
      if let some n := name then
        if seen.contains n then throw (.duplicate n)
      if isMulti seg && !rest.isEmpty then throw .multiNotLast
      let tail ← parseParts (name.toList ++ seen) rest
      pure (seg :: tail)

def parse (pattern : String) : Except ParseError (List Segment) :=
  parseParts [] ((trimSlash pattern).splitOn "/")

def matchParts : List Segment → List String → Option (List (String × String))
  | [], [] => some []
  | [], _ :: _ => none
  | .multiWildcard :: _, _ => some []
  | .multiCapture name :: _, parts => some [(name, String.intercalate "/" parts)]
  | .literal literal :: tail, part :: parts =>
      if literal == part then matchParts tail parts else none
  | .wildcard :: tail, _ :: parts => matchParts tail parts
  | .capture name :: tail, part :: parts => ((name, part) :: ·) <$> matchParts tail parts
  | _ :: _, [] => none

def captures (pattern : List Segment) (path : String) : Option (List (String × String)) :=
  (fun pairs => pairs.mergeSort (fun a b => a.1 ≤ b.1)) <$>
    matchParts pattern ((trimSlash path).splitOn "/")

def isDocument (pattern : List Segment) : Bool :=
  (pattern.getLast?.any isMulti) || pattern.length % 2 == 0

end FunctionsEventPattern
