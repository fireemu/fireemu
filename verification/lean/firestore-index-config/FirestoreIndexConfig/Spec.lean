import Std

namespace FirestoreIndexConfig

inductive Kind where
  | ordered | arrayContains | documentName | vector
  deriving Repr, DecidableEq, BEq

inductive Scope where
  | collection | group
  deriving Repr, DecidableEq

inductive Profile where
  | emulator | deploy
  deriving Repr, DecidableEq, BEq

structure Entry where
  scope : Scope
  fields : List Kind

inductive ShapeError where
  | tooMany | multipleArrays | unnecessary
  deriving Repr, DecidableEq

def arrayCount (entry : Entry) : Nat :=
  (entry.fields.filter (· == .arrayContains)).length

def check (profile : Profile) (entry : Entry) : Except ShapeError Unit :=
  if 100 < entry.fields.length then .error .tooMany
  else if 1 < arrayCount entry then .error .multipleArrays
  else if profile == .deploy && entry.fields.length < 2 &&
      !(entry.fields.any (fun field => field == .documentName || field == .vector)) then
    .error .unnecessary
  else .ok ()

end FirestoreIndexConfig
