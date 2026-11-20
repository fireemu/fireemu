import Std

namespace FTS

inductive Trigger where
  | firestore (kind database : String)
  | storage (kind : String) (bucket : Option String)
  | pubsub (topic : String)
  | auth (kind : String)
  | eventarc (channel kind : String) (requirements : List (String × String))
  | blocking (kind : String)
  deriving DecidableEq

inductive Query where
  | firestore (kind database path : String)
  | storage (kind bucket defaultBucket : String)
  | pubsub (topic : String)
  | auth (kind : String)
  | eventarc (channel kind : String) (attributes : List (String × String))

structure Function where
  name : String
  region : String
  trigger : Trigger

/-- The generator uses only the short and fully qualified channel spellings. -/
def suffix (name : String) : String :=
  match name.splitOn "/" with
  | ["projects", _, "locations", loc, "channels", chan] => s!"locations/{loc}/channels/{chan}"
  | _ => name

def applies (trigger : Trigger) (query : Query) : Bool :=
  match trigger, query with
  | .firestore want db, .firestore haveKind database path =>
    (want == "written" || want == haveKind) && db == database &&
      (match path.splitOn "/" with | ["items", id] => !id.isEmpty | _ => false)
  | .storage k b, .storage actual whereBucket defaultBucket =>
    k == actual && b.getD defaultBucket == whereBucket
  | .pubsub t, .pubsub actual => t == actual
  | .auth k, .auth actual => k == actual
  | .eventarc channel kind required, .eventarc actual actualKind attributes =>
    suffix channel == suffix actual && kind == actualKind && required.all attributes.contains
  | _, _ => false

def dispatch (functions : List Function) (query : Query) : List Function :=
  functions.filter (fun f => applies f.trigger query)

inductive Selection where
  | discovery
  | disabled
  | named (name : String) (region : Option String)

inductive Error where
  | missing | ambiguous | wrongEvent | regionMismatch
  deriving DecidableEq

def blockingTarget (functions : List Function) (kind : String)
    (selection : Selection) : Except Error (Option String) :=
  match selection with
  | .disabled => .ok none
  | .discovery => .ok ((functions.find? (fun f => f.trigger == .blocking kind)).map (·.name))
  | .named name region =>
    match functions.filter (fun f => f.name == name) with
    | [] => .error .missing
    | [f] =>
      if f.trigger != .blocking kind then .error .wrongEvent
      else if region.any (· != f.region) then .error .regionMismatch
      else .ok (some f.name)
    | _ => .error .ambiguous

end FTS
