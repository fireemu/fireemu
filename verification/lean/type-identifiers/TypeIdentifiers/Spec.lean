import Std

namespace TI

inductive Kind where
  | project
  | database
  | catalog
  | collection
  | document
  deriving DecidableEq, Repr

def Kind.label : Kind → String
  | .project => "project"
  | .database => "database"
  | .catalog => "catalog"
  | .collection => "collection"
  | .document => "document"

def Kind.limit : Kind → Nat
  | .project | .database => 63
  | .catalog => 128
  | .collection | .document => 1500

inductive Failure where
  | empty
  | tooLong (got limit : Nat)
  | invalidCharacter (offset : Nat)
  | hyphen
  | slash
  | dot
  | dunder
  | control (offset : Nat)
  deriving DecidableEq, Repr

def firstOffset (bad : Char → Bool) (offset : Nat) : List Char → Option Nat
  | [] => none
  | c :: cs => if bad c then some offset else firstOffset bad (offset + c.utf8Size) cs

def asciiName (c : Char) : Bool :=
  ('a' ≤ c && c ≤ 'z') || ('0' ≤ c && c ≤ '9') || c == '-'

def isControl (c : Char) : Bool :=
  c.toNat < 32 || (127 ≤ c.toNat && c.toNat ≤ 159)

def lowerHyphenated (text : String) : Option Failure :=
  match firstOffset (fun c => !asciiName c) 0 text.toList with
  | some i => some (.invalidCharacter i)
  | none => if text.startsWith "-" || text.endsWith "-" then some .hyphen else none

def pathSegment (text : String) : Option Failure :=
  if text.contains '/' then some .slash
  else
    match firstOffset isControl 0 text.toList with
    | some i => some (.control i)
    | none =>
      if text == "." || text == ".." then some .dot
      else if text.utf8ByteSize ≥ 4 && text.startsWith "__" && text.endsWith "__" then some .dunder
      else none

def refusal (kind : Kind) (text : String) : Option Failure :=
  if text.isEmpty then some .empty
  else if text.utf8ByteSize > kind.limit then some (.tooLong text.utf8ByteSize kind.limit)
  else
    match kind with
    | .collection | .document => pathSegment text
    | .database => if text == "(default)" then none else lowerHyphenated text
    | _ => lowerHyphenated text

end TI
