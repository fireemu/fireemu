import Std

namespace FirestoreIndex

structure Function where
  name : Nat
  database : Option String
  declared : Nat
  shape : Nat
  deriving BEq, DecidableEq, Repr

structure Event where
  database : String
  actual : Nat
  shape : Nat
  parameter : String
  wholePath : String
  deriving BEq, DecidableEq, Repr

def sameDatabase (fn : Function) (db : String) : Bool :=
  fn.database == some db

def matchEvent (event : Event) (fn : Function) : Option (Nat × Nat × String) :=
  if (fn.declared == 3 || fn.declared == event.actual) &&
      (fn.shape == 3 || fn.shape == event.shape)
  then some (fn.name, fn.shape, if fn.shape == 3 then event.wholePath else event.parameter)
  else none

def scan (event : Event) (functions : List Function) : List (Nat × Nat × String) :=
  functions.filterMap fun fn =>
    if sameDatabase fn event.database then matchEvent event fn else none

def bucket (db : String) (functions : List Function) : List Function :=
  functions.foldr (fun fn candidates =>
    if sameDatabase fn db then fn :: candidates else candidates) []

def query (event : Event) (functions : List Function) : List (Nat × Nat × String) :=
  (bucket event.database functions).filterMap (matchEvent event)

end FirestoreIndex
