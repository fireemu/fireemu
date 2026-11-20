import Std

namespace StorageNames

inductive Violation where
  | empty | long | control | dot | objectReserved | bucketCharacter
  | strictShort | strictLong | strictCharacter | strictEnds | strictComponent | strictReserved | strictIp
  deriving DecidableEq, Repr

def firstViolation : List (Bool × Violation) → Option Violation
  | [] => none
  | (bad, reason) :: rules => if bad then some reason else firstViolation rules

def objectRules (name : String) : List (Bool × Violation) :=
  [ (name.isEmpty, .empty)
  , (decide (1024 < name.utf8ByteSize), .long)
  , (name.toList.any (fun c => ['\r', '\n', '\x00'].contains c), .control)
  , (name == "." || name == "..", .dot)
  , (name.startsWith ".well-known/acme-challenge/", .objectReserved)
  ]

def bucketAlnum (c : Char) : Bool := c.isLower || c.isDigit

def bucketChar (c : Char) : Bool :=
  bucketAlnum c || ['-', '_', '.'].contains c

def bucketRules (name : String) : List (Bool × Violation) :=
  [ (name.isEmpty, .empty)
  , (decide (222 < name.utf8ByteSize), .long)
  , (!(name.toList.all bucketChar), .bucketCharacter)
  ]

def ipv4Shape (parts : List String) : Bool :=
  parts.length == 4 &&
    parts.all (fun part => (part.toNat?).any (fun n => decide (n < 256)))

def strictRules (name : String) : List (Bool × Violation) :=
  let parts := name.splitOn "."
  let chars := name.toList
  [ (decide (name.utf8ByteSize < 3), .strictShort)
  , (decide (222 < name.utf8ByteSize), .strictLong)
  , (!(chars.all bucketChar), .strictCharacter)
  , (!(chars.head?.any bucketAlnum && chars.getLast?.any bucketAlnum), .strictEnds)
  , (parts.any (fun part => part.isEmpty || decide (63 < part.utf8ByteSize)), .strictComponent)
  , (name.startsWith "goog" || (name.splitOn "google").length > 1, .strictReserved)
  , (ipv4Shape parts, .strictIp)
  ]

def objectViolation (name : String) : Option Violation := firstViolation (objectRules name)

def bucketViolation (name : String) : Option Violation := firstViolation (bucketRules name)

def strictViolation (name : String) : Option Violation := firstViolation (strictRules name)

end StorageNames
