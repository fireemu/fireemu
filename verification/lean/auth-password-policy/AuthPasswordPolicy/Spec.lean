import Std

namespace AuthPasswordPolicy

inductive Enforcement where
  | off | unspecified | enforce
  deriving DecidableEq, Repr

inductive Operation where
  | register | add | change | admin | reset | signin
  deriving DecidableEq, Repr

inductive Violation where
  | minimum | maximum | lowercase | uppercase | numeric | punctuation
  deriving DecidableEq, Repr

structure Policy where
  minimum : Nat
  maximum : Option Nat
  lowercase : Bool
  uppercase : Bool
  numeric : Bool
  punctuation : Bool
  allowed : List Char
  deriving Repr

def units (character : Char) : Nat :=
  if character.toNat < 65536 then 1 else 2

def utf16Length (password : String) : Nat :=
  (password.toList.map units).sum

def inAsciiRange (first last character : Char) : Bool :=
  first.toNat ≤ character.toNat && character.toNat ≤ last.toNat

def allowedPunctuation (character : Char) : Bool :=
  let cp := character.toNat
  32 ≤ cp && cp < 127 &&
    !(inAsciiRange 'a' 'z' character || inAsciiRange 'A' 'Z' character ||
      inAsciiRange '0' '9' character)

def violations (policy : Policy) (password : String) : List Violation :=
  let characters := password.toList
  let length := utf16Length password
  let checks : List (Bool × Violation) :=
    [ (length < policy.minimum, .minimum)
    , (policy.maximum.any (length > ·), .maximum)
    , (policy.lowercase && !characters.any (inAsciiRange 'a' 'z'), .lowercase)
    , (policy.uppercase && !characters.any (inAsciiRange 'A' 'Z'), .uppercase)
    , (policy.numeric && !characters.any (inAsciiRange '0' '9'), .numeric)
    , (policy.punctuation && !characters.any policy.allowed.contains, .punctuation) ]
  checks.filterMap fun (missing, code) => if missing then some code else none

def rejects (enforcement : Enforcement) (forced : Bool) (operation : Operation)
    (policy : Policy) (password : String) : Bool :=
  decide (enforcement = .enforce) &&
    (decide (operation ≠ .signin) || forced) &&
    !(violations policy password).isEmpty

inductive ConfigError where
  | minimum | maximum | punctuation
  deriving DecidableEq, Repr

def validateConfiguration (minimum : Nat) (maximum : Option Nat) (allowed : List Char) :
    Option ConfigError :=
  if minimum < 6 || minimum > 30 then some .minimum
  else if maximum.any (fun max => max < minimum || max > 4096) then some .maximum
  else if allowed.all allowedPunctuation then none else some .punctuation

end AuthPasswordPolicy
