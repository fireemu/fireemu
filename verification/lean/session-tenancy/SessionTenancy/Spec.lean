import Std

namespace ST

structure Project where
  name : String
  buckets : List String
  keys : List String
  deriving Repr, DecidableEq

structure State where
  base : String
  baseKeys : List String
  registrations : List Project
  deriving Repr, DecidableEq

def conventional (bucket : String) : Option String :=
  [".appspot.com", ".firebasestorage.app"].findSome? fun suffix =>
    if bucket.endsWith suffix then
      let project := String.ofList (bucket.toList.take (bucket.length - suffix.length))
      if project.isEmpty then none else some project
    else none

def registered (s : State) (project : String) : Bool :=
  s.registrations.any (fun p => p.name == project)

def ownerOfKey (s : State) (key : String) : Option String :=
  (s.registrations.find? (fun p => p.keys.contains key)).map (·.name)

def projectOfBucket (s : State) (bucket : String) : String :=
  match (conventional bucket).filter (fun p => p == s.base || registered s p) with
  | some p => p
  | none => ((s.registrations.find? (fun p => p.buckets.contains bucket)).map (·.name)).getD s.base

def refusesKey (s : State) (key : String) : Bool :=
  !s.baseKeys.isEmpty && !s.baseKeys.contains key && (ownerOfKey s key).isNone

def owns (s : State) (scopeProject query : String) : Bool :=
  if registered s scopeProject then scopeProject == query else !registered s query

def bucketError (s : State) (project bucket : String) : Option String :=
  let owner := projectOfBucket s bucket
  if owner != s.base && owner != project then some s!"bucket {repr bucket} belongs to project {repr owner}"
  else if (conventional bucket).any (· != project) then
    some s!"bucket {repr bucket} is another project's default bucket"
  else none

def keyError (s : State) (key : String) : Option String :=
  (ownerOfKey s key).map fun owner => s!"API key {repr key} belongs to project {repr owner}"

def conflict (s : State) (proposal : Project) : Option String :=
  if proposal.name == s.base then some "the default project cannot be registered"
  else if registered s proposal.name then some s!"project {repr proposal.name} is already registered"
  else (proposal.buckets.findSome? (bucketError s proposal.name)).orElse fun _ =>
    proposal.keys.findSome? (keyError s)

def register (s : State) (p : Project) : Option String × State :=
  match conflict s p with
  | some message => (some message, s)
  | none => (none, {s with registrations := p :: s.registrations})

def unregister (s : State) (project : String) : Bool × State :=
  (registered s project, {s with registrations := s.registrations.filter (fun p => p.name != project)})

def sortNames (xs : List String) : List String :=
  xs.mergeSort (fun a b => decide (a ≤ b))

def registeredKeys (s : State) (project : String) : List String :=
  if project == s.base then s.baseKeys
  else ((s.registrations.find? (fun p => p.name == project)).map (·.keys)).getD []

def firstKey (s : State) (project : String) : Option String :=
  (sortNames (registeredKeys s project)).head?

def bucketsOf (s : State) (project : String) : List String :=
  sortNames (((s.registrations.find? (fun p => p.name == project)).map (·.buckets)).getD [])

def bucketsToProbe : List String :=
  ["demo-default.appspot.com", "demo-default.firebasestorage.app", "demo-a.appspot.com",
   "demo-b.appspot.com", "demo-c.firebasestorage.app", "alias-a", "alias-b", "alias-c",
   "unowned", ".appspot.com", "alias-new"]

def keysToProbe : List String :=
  ["key-default", "key-shared", "key-a", "key-b", "key-c", "new-key", "unknown", ""]

def projectsToProbe : List String := ["demo-default", "demo-a", "demo-b", "demo-c", "other"]

def encoded (value : Option String) : String := value.getD "-"

def snapshot (s : State) : String :=
  String.intercalate ";" [
    String.intercalate "," (sortNames (s.registrations.map (·.name))),
    String.intercalate "," (bucketsToProbe.map (projectOfBucket s)),
    String.intercalate "," (keysToProbe.map (fun k =>
      s!"{encoded (ownerOfKey s k)}:{s.baseKeys.contains k}:{refusesKey s k}")),
    String.intercalate "," (projectsToProbe.map (fun p =>
      s!"{encoded (firstKey s p)}:{registered s p}:{String.intercalate "+" (bucketsOf s p)}")),
    String.intercalate "," (projectsToProbe.map (fun p =>
      String.ofList (projectsToProbe.map (fun q => if owns s p q then '1' else '0'))))
  ]

def occupiers : List Project :=
  [⟨"demo-b", ["alias-b"], ["key-shared", "key-b"]⟩, ⟨"demo-a", ["alias-a"], ["key-a"]⟩]

def baselines : List (String × List Project) :=
  [("empty", []), ("occupied", occupiers.take 1), ("full", occupiers)]

def keyPolicies : List (String × List String) :=
  [("open", []), ("declared", ["key-shared", "key-default"])]

def proposals : List (String × Project) := [
  ("freshA", ⟨"demo-a", ["alias-new", "alias-a"], ["key-a"]⟩),
  ("freshC", ⟨"demo-c", ["alias-c"], ["key-c"]⟩),
  ("default", ⟨"demo-default", [], []⟩),
  ("duplicate", ⟨"demo-b", ["alias-new"], ["new-key"]⟩),
  ("foreignRegistered", ⟨"demo-c", ["demo-b.appspot.com"], []⟩),
  ("foreignUnregistered", ⟨"demo-a", ["demo-c.firebasestorage.app"], []⟩),
  ("ownConventional", ⟨"demo-c", ["demo-c.firebasestorage.app"], []⟩),
  ("bucketBeforeKey", ⟨"demo-c", ["alias-new", "alias-b"], ["key-b"]⟩),
  ("keyAfterFreeKey", ⟨"demo-c", ["alias-c"], ["new-key", "key-b", "key-a"]⟩),
  ("baseKeyOverlap", ⟨"demo-c", [], ["key-default"]⟩),
  ("emptyPrefix", ⟨"demo-c", [".appspot.com"], []⟩)
]

end ST
