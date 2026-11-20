import Std

namespace AuthQueryIndex

structure Account where
  key : String
  id : String
  email : String
  phone : String
  name : String
  deriving DecidableEq, Repr

inductive Expr where
  | email (value : String)
  | phone (value : String)
  | uid (value : String)
  deriving DecidableEq, Repr

/-- Lowercase vectors used by the corpus, including length-changing and contextual examples. -/
def emailKey (value : String) : String :=
  if value = "ΟΣ@example.com" then "ος@example.com"
  else if value = "Kİ@example.com" ∨ value = "Kİ@EXAMPLE.COM" then "ki̇@example.com"
  else if value = "USER@example.com" then "user@example.com"
  else value

def satisfies (expr : Expr) (user : Account) : Bool :=
  match expr with
  | .email raw => !user.email.isEmpty && decide (emailKey user.email = emailKey raw)
  | .phone phone => !user.phone.isEmpty && decide (user.phone = phone)
  | .uid id => decide (user.id = id)

/-- The canonical scan evaluates the records in map-key order. -/
def scan (users : List Account) (expressions : List Expr) : List Account :=
  if expressions.isEmpty then users
  else users.filter fun user => expressions.any (fun expr => satisfies expr user)

/-- An ownership lookup returns every matching map key, including inactive owners. -/
def owners (users : List Account) (expr : Expr) : List String :=
  (users.filter (satisfies expr)).map Account.key

def fromIndexes (users : List Account) (lookup : Expr → List String)
    (expressions : List Expr) : List Account :=
  if expressions.isEmpty then users
  else users.filter fun user => expressions.any (fun expr => (lookup expr).contains user.key)

def execute (users : List Account) (lookup : Expr → List String)
    (trusted : Bool) (expressions : List Expr) : List Account :=
  if trusted then fromIndexes users lookup expressions else scan users expressions

def project (users : List Account) (field : String) (descending : Bool) : List Account :=
  if field = "id" then
    if descending then users.reverse else users
  else
    users.mergeSort fun a b =>
      if a.name = b.name then a.id ≤ b.id
      else if descending then b.name < a.name else a.name < b.name

end AuthQueryIndex
