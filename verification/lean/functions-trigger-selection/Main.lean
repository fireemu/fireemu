import FunctionsTriggerSelection

open FTS

def fnSpec (name : String) (trigger : Trigger) (region := "us-central1") : Function :=
  ⟨name, region, trigger⟩

def short := "locations/us-central1/channels/c"
def full := "projects/demo/locations/us-central1/channels/c"
def other := "locations/us-east1/channels/c"

def manifest : List Function := [
  fnSpec "zDoc" (.firestore "written" "(default)"),
  fnSpec "zBucket" (.storage "finalized" none),
  fnSpec "zMessage" (.pubsub "jobs"),
  fnSpec "zUser" (.auth "created"),
  fnSpec "zCustom" (.eventarc short "done" [("area", "eu")]),
  fnSpec "zBlock" (.blocking "create"),
  fnSpec "aDoc" (.firestore "created" "(default)"),
  fnSpec "aBucket" (.storage "finalized" (some "primary")),
  fnSpec "xDoc" (.firestore "deleted" "archive"),
  fnSpec "aMessage" (.pubsub "jobs"),
  fnSpec "aUser" (.auth "created"),
  fnSpec "aCustom" (.eventarc full "done" []),
  fnSpec "aBlock" (.blocking "create") "us-east1",
  fnSpec "xBucket" (.storage "archived" (some "cold")),
  fnSpec "xCustom" (.eventarc short "other" []),
  fnSpec "xUser" (.auth "deleted"),
  fnSpec "xBlock" (.blocking "signIn")
]

def queries : List (String × List Query) := [
  ("firestore", [
    .firestore "created" "(default)" "items/x", .firestore "updated" "(default)" "items/y",
    .firestore "deleted" "archive" "items/a", .firestore "deleted" "(default)" "other/a",
    .firestore "created" "archive" "items/x", .firestore "created" "(default)" "items/x/nested/y"]),
  ("storage", [
    .storage "finalized" "primary" "primary", .storage "finalized" "cold" "cold",
    .storage "archived" "cold" "primary", .storage "archived" "primary" "cold",
    .storage "finalized" "primary" "cold", .storage "deleted" "primary" "primary"]),
  ("pubsub", ["jobs","other","Jobs","projects/demo/topics/jobs","","job"].map Query.pubsub),
  ("auth", ["created","deleted"].map Query.auth),
  ("eventarc", [
    .eventarc full "done" [("area","eu")], .eventarc short "done" [("area","us")],
    .eventarc short "done" [], .eventarc other "done" [("area","eu")],
    .eventarc full "other" [], .eventarc full "done" [("area","eu"),("extra","1")]])
]

def digest (fs : List Function) (q : Query) : String :=
  let chosen := dispatch fs q
  String.intercalate "," (chosen.map fun f =>
    match q with
    | .firestore _ _ path => s!"{f.name}:{(path.splitOn "/").getLastD ""}"
    | _ => f.name)

def blockingName : Except Error (Option String) → String
  | .ok n => n.getD ""
  | .error .missing => "missing"
  | .error .ambiguous => "ambiguous"
  | .error .wrongEvent => "wrong-event"
  | .error .regionMismatch => "region-mismatch"

def main : IO Unit := do
  IO.println "# family|case|manifest order|selected functions or refusal"
  for (order, functions) in [("forward", manifest), ("reverse", manifest.reverse)] do
    for (family, qs) in queries do
      for (q, index) in qs.zipIdx do
        IO.println s!"{family}|{index}|{order}|{digest functions q}"
    let selections := [
      Selection.discovery, .disabled, .named "aBlock" (some "us-east1"), .named "absent" none,
      .named "xBlock" (some "us-east1"), .named "zBlock" (some "us-east1")]
    for (selection, index) in selections.zipIdx do
      IO.println s!"blocking|{index}|{order}|{blockingName (blockingTarget functions "create" selection)}"
    let duplicates := fnSpec "zBlock" (.blocking "signIn") :: functions
    IO.println s!"blocking|6|{order}|{blockingName (blockingTarget duplicates "create" (.named "zBlock" (some "us-east1")))}"
