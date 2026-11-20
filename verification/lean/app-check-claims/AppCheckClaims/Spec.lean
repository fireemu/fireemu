import Std

namespace AppCheckClaims

def second : Int := 1000000000

def i64Min : Int := -(2 ^ 63)
def i64Max : Int := 2 ^ 63 - 1

def fitsI64 (value : Int) : Prop := i64Min ≤ value ∧ value ≤ i64Max

instance (value : Int) : Decidable (fitsI64 value) := by
  unfold fitsI64
  infer_instance

def unixSeconds (instant : Int) : Int :=
  let whole := instant / second
  if fitsI64 whole then whole else i64Max

def saturate (value : Int) : Int :=
  if value < i64Min then i64Min else if value > i64Max then i64Max else value

def expiry (issued requested : Int) : Int :=
  saturate (issued + requested)

def reportedLifetime (issued ending : Int) : Int :=
  saturate (ending - issued)

def validConfiguredTtl (ttl : Int) : Bool :=
  1800 ≤ ttl && ttl ≤ 604800

structure App where
  project : String
  number : String
  id : String
  epoch : Nat

def issuer (app : App) : String :=
  "https://firebaseappcheck.googleapis.com/" ++ app.number

def audiences (app : App) : List String :=
  ["projects/" ++ app.number, "projects/" ++ app.project]

def epochText (value : Nat) : String :=
  let alphabet := "0123456789abcdef".toList
  String.ofList ((List.range 32).reverse.map fun shift => alphabet[value / 16 ^ shift % 16]!)

inductive Mode where
  | off | unenforced | enforced
  deriving DecidableEq, Repr

inductive Credential where
  | bypass | missing | valid (identity : String) | invalid (detail : String)
  deriving DecidableEq, Repr

inductive Denial where
  | required | invalid
  deriving DecidableEq, Repr

def denial (mode : Mode) (credential : Credential) : Option Denial :=
  match mode, credential with
  | .enforced, .missing => some .required
  | .enforced, .invalid _ => some .invalid
  | _, _ => none

def exposedIdentity (mode : Mode) (credential : Credential) : Option String :=
  if (denial mode credential).isSome then none
  else match credential with
    | .valid identity => some identity
    | _ => none

end AppCheckClaims
