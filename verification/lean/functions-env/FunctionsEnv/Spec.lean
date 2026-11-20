import Std

namespace FunctionsEnv

inductive KeyError where
  | exact
  | shape
  | prefix
  | emptySuffix
  deriving Repr, DecidableEq

def reservedKeys : List String :=
  ["FIREBASE_CONFIG", "CLOUD_RUNTIME_CONFIG", "EVENTARC_CLOUD_EVENT_SOURCE",
   "ENTRY_POINT", "GCP_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT",
   "FUNCTION_TRIGGER_TYPE", "FUNCTION_NAME", "FUNCTION_MEMORY_MB", "FUNCTION_TIMEOUT_SEC",
   "FUNCTION_IDENTITY", "FUNCTION_REGION", "FUNCTION_TARGET", "FUNCTION_SIGNATURE_TYPE",
   "K_SERVICE", "K_REVISION", "PORT", "K_CONFIGURATION"]

def prefixes : List String := ["X_GOOGLE_", "FIREBASE_", "EXT_", "KIT_"]

def exceptions : List String :=
  ["FIREBASE_SECRET_REF_", "EXT_MIGRATED_SYSTEM_", "EXT_SELECTED_EVENTS"]

def uppercase (c : Char) : Bool := ('A' ≤ c && c ≤ 'Z') || c == '_'

def shaped (key : String) : Bool :=
  match key.toList with
  | [] => false
  | first :: rest => uppercase first && rest.all (fun c => uppercase c || ('0' ≤ c && c ≤ '9'))

def validate (key : String) : Except KeyError Unit :=
  if reservedKeys.contains key then .error .exact
  else if !shaped key then .error .shape
  else if exceptions.contains key then .error .emptySuffix
  else if prefixes.any (fun p => key.startsWith p) && !exceptions.any (fun p => key.startsWith p) then
    .error .prefix
  else .ok ()

def keyMessage (key : String) : KeyError → String
  | .exact => s!"Key {key} is reserved for internal use."
  | .shape => s!"Key {key} must start with an uppercase ASCII letter or underscore, and then consist of uppercase ASCII letters, digits, and underscores."
  | .prefix => s!"Key {key} starts with a reserved prefix ({String.intercalate " " prefixes})"
  | .emptySuffix => s!"Key {key} is a known prefix with an empty suffix"

def fileOrder (project : String) (alias : Option String) : List String :=
  [".env", ".env." ++ project] ++ alias.toList.map (".env." ++ ·) ++ [".env.local"]

inductive Quote where
  | bare
  | single
  | double
  deriving Repr, DecidableEq

def expandDouble : List Char → List Char
  | '\\' :: 'n' :: rest => '\n' :: expandDouble rest
  | '\\' :: 'r' :: rest => '\r' :: expandDouble rest
  | '\\' :: 't' :: rest => '\t' :: expandDouble rest
  | '\\' :: 'v' :: rest => Char.ofNat 11 :: expandDouble rest
  | '\\' :: '\\' :: rest => '\\' :: expandDouble rest
  | '\\' :: '\'' :: rest => '\'' :: expandDouble rest
  | '\\' :: '"' :: rest => '"' :: expandDouble rest
  | '\\' :: other :: rest => '\\' :: other :: expandDouble rest
  | other :: rest => other :: expandDouble rest
  | [] => []

/-- Values already partitioned by quoting syntax. Unclosed quotes and lexical recovery
are outside this subset; concrete invalid-file diagnostics are exercised in the corpus. -/
def value (quote : Quote) (body : String) : String :=
  match quote with
  | .bare => (String.ofList (body.toList.takeWhile (· != '#'))).trimAscii.toString
  | .single => body
  | .double => String.ofList (expandDouble body.toList)

def readAssignment (key : String) (assignments : List (String × String)) : Option String :=
  (assignments.reverse.find? (fun pair => pair.1 == key)).map Prod.snd

end FunctionsEnv
