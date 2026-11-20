import Std

namespace FE

inductive Edition where
  | standard
  | enterprise
  deriving DecidableEq, Repr

inductive API where
  | native
  | mongo
  deriving DecidableEq, Repr

inductive Capability where
  | unsupported
  | preview
  deriving DecidableEq, Repr

structure Flags where
  core : Bool
  pipeline : Bool
  text : Capability
  geospatial : Capability
  deriving DecidableEq, Repr

inductive Error where
  | invalidCombination
  | catalogMismatch
  deriving DecidableEq, Repr

def Edition.label : Edition → String
  | .standard => "standard"
  | .enterprise => "enterprise"

def API.label : API → String
  | .native => "native"
  | .mongo => "mongodb-compatible"

def catalogMatches (edition : Edition) (catalog : String) : Bool :=
  catalog.startsWith ("firestore-" ++ edition.label ++ "-")

def flags : Edition → API → Flags
  | .enterprise, .native => ⟨true, true, .preview, .preview⟩
  | .standard, .native => ⟨true, false, .unsupported, .unsupported⟩
  | _, .mongo => ⟨false, false, .unsupported, .unsupported⟩

def admit (e : Edition) (a : API) (catalog : String) : Except Error Flags :=
  match e, a with
  | .standard, .mongo => .error .invalidCombination
  | _, _ => if catalogMatches e catalog then .ok (flags e a) else .error .catalogMismatch

end FE
