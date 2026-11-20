import Std

namespace AppCheckAdmission

inductive Header where
  | missing
  | present (value : String)
  | malformed
  deriving DecidableEq, Repr

def eligible (value : String) : Bool :=
  !value.isEmpty && value.utf8ByteSize ≤ 16384 &&
    value.toList.all fun character =>
      33 ≤ character.toNat && character.toNat ≤ 126 && character != ','

def classify : List String → Header
  | [] => .missing
  | [value] => if eligible value then .present value else .malformed
  | _ => .malformed

def collect (fields : List (String × String)) : List String :=
  (fields.filter fun (name, _) => name.toLower == "x-firebase-appcheck").map Prod.snd

def isHex (c : Char) : Bool :=
  "0123456789abcdef".toList.contains c.toLower

def hexGroup (width : Nat) (part : String) : Bool :=
  part.length == width && part.toList.all isHex

def uuidV4 (text : String) : Bool :=
  match text.splitOn "-" with
  | [a, b, c, d, e] =>
    hexGroup 8 a && hexGroup 4 b && hexGroup 4 c && hexGroup 4 d && hexGroup 12 e &&
    c.toList.head? == some '4' &&
    d.toList.head?.any (fun digit => "89ab".toList.contains digit.toLower)
  | _ => false

def normalize (text : String) : Option String :=
  if uuidV4 text then some text.toLower else none

end AppCheckAdmission
