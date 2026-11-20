import Std

namespace ConfigDiscovery

inductive FileState where
  | absent | good | unreadable | writable
  deriving Repr, DecidableEq

def FileState.present : FileState → Bool
  | .absent => false
  | _ => true

structure Tree where
  toml : FileState := .absent
  json : FileState := .absent
  localFirebase : FileState := .absent
  nearFirebase : FileState := .absent
  farFirebase : FileState := .absent
  workingWritable : Bool := false
  nearWritable : Bool := false

inductive Decision where
  | nothing
  | ambiguous
  | skip (path : String)
  | select (canonical : Bool) (path : String) (readable : Bool)
  deriving Repr, DecidableEq

def conclude (canonical : Bool) (path : String) : FileState → Decision
  | .absent => .nothing
  | .good => .select canonical path true
  | .unreadable => .select canonical path false
  | .writable => .skip path

/-- A bounded three-directory reference. Directory ownership and permissions beyond the modeled
world-write bit are outside this domain. -/
def discover (tree : Tree) : Decision :=
  if tree.workingWritable then .skip "/suite/near/work"
  else if tree.toml.present && tree.json.present then .ambiguous
  else if tree.toml.present then conclude true "fireemu.toml" tree.toml
  else if tree.json.present then conclude true "fireemu.json" tree.json
  else if tree.localFirebase.present then conclude false "firebase.json" tree.localFirebase
  else if tree.nearWritable then
    if tree.nearFirebase.present then .skip "/suite/near/firebase.json" else .nothing
  else if tree.nearFirebase.present then conclude false "/suite/near/firebase.json" tree.nearFirebase
  else conclude false "/suite/firebase.json" tree.farFirebase

end ConfigDiscovery
