import Std

namespace ServiceStartPlan

inductive Service where
  | firestore | auth | storage | hosting | functions | eventarc | tasks | pubsub | database
  deriving Repr, BEq, DecidableEq

def serviceName : Service → String
  | .firestore => "firestore"
  | .auth => "auth"
  | .storage => "storage"
  | .hosting => "hosting"
  | .functions => "functions"
  | .eventarc => "eventarc"
  | .tasks => "tasks"
  | .pubsub => "pubsub"
  | .database => "database"

def services : List Service :=
  [.firestore, .auth, .storage, .hosting, .functions, .eventarc, .tasks, .pubsub, .database]

def primary : List Service :=
  [.firestore, .auth, .storage, .hosting, .functions, .pubsub, .database]

structure Config where
  functions : Bool := false
  hosting : Bool := false
  pubsub : Bool := false
  database : Bool := false

inductive Refusal where
  | hosting
  | support
  deriving Repr, DecidableEq

def starts (explicit : Bool) (selected : List Service) (config : Config) : Service → Bool
  | .functions | .eventarc | .tasks => selected.contains .functions && config.functions
  | .hosting => selected.contains .hosting && config.hosting
  | .pubsub => selected.contains .pubsub && (explicit || config.pubsub)
  | .database => selected.contains .database && (explicit || config.database)
  | service => selected.contains service

/-- Product services only; the Hub, UI and Logging are separate in the real plan. The corpus
uses no standalone support-emulator port configuration. -/
def plan (only : Option (List Service)) (config : Config) : Except Refusal (List Service) :=
  let selected := only.getD primary
  if only.isSome && selected.contains .hosting && !config.hosting then .error .hosting
  else if only.isSome && !(selected.any fun service => primary.contains service) then .error .support
  else .ok (services.filter (starts only.isSome selected config))

end ServiceStartPlan
