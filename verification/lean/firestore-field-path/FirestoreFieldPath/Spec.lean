import Std

namespace FirestoreFieldPath

def limit : Nat := 1500

def tick : Char := Char.ofNat 96
def slash : Char := Char.ofNat 92

def startsSimple (c : Char) : Bool :=
  ('a' ≤ c && c ≤ 'z') || ('A' ≤ c && c ≤ 'Z') || c == '_'

def digit (c : Char) : Bool :=
  '0' ≤ c && c ≤ '9'

def simple : List Char → Bool
  | [] => false
  | first :: tail => startsSimple first && tail.all (fun c => startsSimple c || digit c)

def needsEscape (c : Char) : Bool := c == tick || c == slash

def escape : List Char → List Char
  | [] => []
  | c :: cs =>
    if needsEscape c then slash :: c :: escape cs else c :: escape cs

/-- Recognize the content and remainder after an opening quote. Only a quote or backslash may follow an escape. -/
def quotedContent : List Char → Bool → Option (List Char × List Char)
  | [], _ => none
  | c :: cs, afterEscape =>
      let withChar := fun (xs, suffix) => (c :: xs, suffix)
      if afterEscape then
        if needsEscape c then (quotedContent cs false).map withChar else none
      else if c = tick then some ([], cs)
      else if c = slash then quotedContent cs true
      else (quotedContent cs false).map withChar

def fullyQuote (s : String) : String :=
  String.ofList (tick :: escape s.toList ++ [tick])

def renderSegment (s : String) : String :=
  if simple s.toList then s else fullyQuote s

def canonical (segments : List String) : String :=
  String.intercalate "." (segments.map renderSegment)

def pathBytes (segments : List String) : Nat :=
  (segments.map String.utf8ByteSize).sum + (segments.length - 1)

inductive Fault
  | empty
  | emptySegment (index : Nat)
  | control (offset : Nat)
  | reserved (index : Nat)
  | segmentBytes (index bytes : Nat)
  | pathBytes (bytes : Nat)
  deriving DecidableEq, Repr

/-- Unicode category Cc is the C0 and C1 control ranges, including DEL. -/
def isControl (c : Char) : Bool :=
  c.toNat ≤ 31 || (127 ≤ c.toNat && c.toNat ≤ 159)

def controlOffset : List Char → Nat → Option Nat
  | [], _ => none
  | c :: cs, offset =>
      if isControl c then some offset else controlOffset cs (offset + c.utf8Size)

def reserved (s : String) : Bool :=
  s != "__name__" && s.utf8ByteSize ≥ 4 && s.startsWith "__" && s.endsWith "__"

def firstFault : List String → Nat → Option Fault
  | [], _ => none
  | s :: tail, index =>
    if s.isEmpty then some (.emptySegment index)
    else if let some offset := controlOffset s.toList 0 then some (.control offset)
    else if s.utf8ByteSize > limit then some (.segmentBytes index s.utf8ByteSize)
    else if reserved s then some (.reserved index)
    else firstFault tail (index + 1)

def validate (segments : List String) : Except Fault Unit :=
  match segments with
  | [] => .error .empty
  | _ =>
    match firstFault segments 0 with
    | some fault => .error fault
    | none =>
      if pathBytes segments ≤ limit then .ok () else .error (.pathBytes (pathBytes segments))

end FirestoreFieldPath
