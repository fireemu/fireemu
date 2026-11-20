import Std

namespace Verbatim

inductive Scalar
  | absent | null | no | yes | zero | nonzero | empty | text | array | object
  deriving BEq, DecidableEq, Repr

inductive Nested
  | absent | plain | stringField | timestampField | malformedString | null
  deriving BEq, DecidableEq, Repr

def outerAllows : Scalar → Bool
  | .absent | .null | .no | .zero | .empty => false
  | _ => true

def eventType : Scalar → Option String
  | .empty => some ""
  | .text => some "alert"
  | _ => none

def topText : Scalar → Option String
  | .empty => some ""
  | .text => some "top"
  | _ => none

def nestedText : Nested → Option String
  | .plain => some "plain"
  | .stringField => some "string"
  | .timestampField => some "timestamp"
  | _ => none

def filterAttribute (top : Scalar) (nested : Nested) : Option String :=
  (topText top).orElse (fun _ => nestedText nested)

def admittedType (value : Scalar) : Option String :=
  if outerAllows value then eventType value else none

end Verbatim
