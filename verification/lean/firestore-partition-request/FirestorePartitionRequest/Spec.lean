import Std

namespace FirestorePartitionRequest

inductive Scope where
  | collection | group | kindless | children
  deriving DecidableEq, Repr

inductive Refusal where
  | scope | limit | offset | projection | start | finish
  deriving DecidableEq, Repr

structure Shape where
  scope : Scope
  strict : Bool
  limit : Bool
  offset : Bool
  projection : Bool
  start : Bool
  finish : Bool
  ordered : Bool
  deriving Repr

def rules (q : Shape) : List (Bool × Refusal) :=
  [(q.limit, .limit), (q.offset, .offset), (q.strict && q.projection, .projection),
   (q.start, .start), (q.finish, .finish)]

def firstRefusal (rules : List (Bool × Refusal)) : Option Refusal :=
  (rules.find? fun rule => rule.1).map Prod.snd

def decide (q : Shape) : Except Refusal Bool :=
  match q.scope with
  | .kindless => .ok false
  | .collection | .children => .error .scope
  | .group =>
    match firstRefusal (rules q) with
    | some r => .error r
    | none => .ok q.ordered

def message : Refusal → String
  | .scope => "Query must select all descendant collections."
  | .limit => "Query limit is not supported."
  | .offset => "Query offset is not supported."
  | .projection => "Property masks are not supported."
  | .start => "Query start cursors are not supported."
  | .finish => "Query end cursors are not supported."

end FirestorePartitionRequest
