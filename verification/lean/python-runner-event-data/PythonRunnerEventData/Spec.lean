import Std

namespace PySlice

structure Member (α : Type) where
  name : String
  spelling : String
  value : α

def firstMember (wanted : String) : List (Member α) → Option α
  | [] => none
  | member :: tail =>
    if member.name == wanted then some member.value else firstMember wanted tail

inductive Boundary where
  | close
  | comma
  | missing
  deriving DecidableEq

structure Slice where
  source : String
  boundary : Boundary

abbrev EventObject := List (Member Slice)
abbrev RootObject := List (Member (Option EventObject))

/-- The first decoded key at each object level selects the source span. -/
def select (root : Option RootObject) : Option String := do
  let root ← root
  let event ← firstMember "event" root
  let event ← event
  let data ← firstMember "data" event
  match data.boundary with
  | .close | .comma => some data.source
  | .missing => none

def retainsSource (trigger : String) : Bool :=
  ["eventarc", "pubsub", "storage", "database"].contains trigger

def inFrame (trigger : String) (hasData : Bool)
    (root : Option RootObject) : Option String :=
  if hasData && retainsSource trigger then select root else none

end PySlice
