import Std

namespace RunnerStructuredLog

inductive Root where
  | object | whitespaceObject | array | null | number | malformed | plain
  deriving DecidableEq, Repr

structure Payload where
  depth : Nat
  wellFormedUtf16 : Bool
  deriving Repr

def levels : List String :=
  ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]

def isObject : Root → Bool
  | .object | .whitespaceObject => true
  | _ => false

def accepts (args : Nat) (root : Root) (severity : String) (payload : Payload) : Bool :=
  args == 1 && isObject root && levels.contains severity.toLower &&
    payload.depth <= 64 && payload.wellFormedUtf16

def output (args : Nat) (root : Root) (severity : String) (payload : Payload) : Option String :=
  if accepts args root severity payload then some severity.toLower else none

end RunnerStructuredLog
