import Std

namespace AuthUserPagination

structure User where
  uid : String
  name : Option String
  email : Option String
  phone : Option String
  created : Int
  login : Option Int
  deriving DecidableEq

inductive Field where
  | uid | name | email | created | login
  deriving DecidableEq

inductive Predicate where
  | uid (text : String)
  | email (text : String)
  | phone (text : String)

def optionalCompare (cmp : α → α → Ordering) : Option α → Option α → Ordering
  | none, none => .eq
  | none, some _ => .lt
  | some _, none => .gt
  | some a, some b => cmp a b

def millis (time : Int) : Int := time.tdiv 1000000

def byField (field : Field) (a b : User) : Ordering :=
  match field with
  | .uid => compare a.uid b.uid
  | .name => optionalCompare compare a.name b.name
  | .email => optionalCompare compare a.email b.email
  | .created => compare (millis a.created) (millis b.created)
  | .login => optionalCompare compare (a.login.map millis) (b.login.map millis)

def stableCompare (field : Field) (desc : Bool) (a b : User) : Ordering :=
  let primary := byField field a b
  if primary == .eq then compare a.uid b.uid
  else if desc then primary.swap else primary

def matchPredicate (user : User) : Predicate → Bool
  | .uid id => user.uid == id
  | .phone value => user.phone == some value
  | .email email => user.email.any fun value => value.toLower == email.toLower

def matching (filters : List Predicate) (users : List User) : List User :=
  users.filter fun user => filters.isEmpty || filters.any (matchPredicate user)

def insert (before : α → α → Bool) (item : α) : List α → List α
  | [] => [item]
  | head :: tail =>
    if before item head then item :: head :: tail else head :: insert before item tail

def full (before : α → α → Bool) (users : List α) : List α :=
  users.foldl (fun acc item => insert before item acc) []

def bounded (before : α → α → Bool) (keep : Nat) (users : List α) : List α :=
  users.foldl (fun acc item => (insert before item acc).take keep) []

def page (field : Field) (desc : Bool) (filters : List Predicate)
    (offset limit : Nat) (users : List User) : List User :=
  let sorted := full (fun a b => stableCompare field desc a b != .gt) (matching filters users)
  (sorted.drop offset).take limit

end AuthUserPagination
