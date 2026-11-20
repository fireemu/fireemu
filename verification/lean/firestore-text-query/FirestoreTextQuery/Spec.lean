import Std

namespace FirestoreTextQuery

abbrev Fields := List (String × List String)

structure Clause where
  field : Option String
  tokens : List String
  excludes : Bool
  deriving DecidableEq, Repr

inductive Query where
  | plain (tokens : List String)
  | legacy (clauses : List Clause)
  | syntaxError
  deriving DecidableEq, Repr

inductive Verdict where
  | invalid | unknown | hit | miss
  deriving DecidableEq, Repr

/-- The reference uses contiguous source-token slices, independent of inverted positions. -/
def hasPhrase (tokens field : List String) : Bool :=
  (List.range (field.length + 1)).any fun start =>
    (field.drop start).take tokens.length == tokens

def termOccurs (fields : Fields) (term : String) : Bool :=
  fields.any fun (_, tokens) => tokens.contains term

def clauseMatches (fields : Fields) (c : Clause) : Bool :=
  fields.any fun (path, tokens) =>
    c.field.all (· == path) && hasPhrase c.tokens tokens

def plainMatches (fields : Fields) (terms : List String) : Bool :=
  !terms.isEmpty &&
    (terms.all (termOccurs fields) ||
      (terms.length ≥ 2 && termOccurs fields (String.join terms)))

def covered (indexed : List String) (clauses : List Clause) : Bool :=
  clauses.all fun c => c.field.all indexed.contains

def membership (indexed : List String) (query : Query) (fields : Fields) : Verdict :=
  match query with
  | .syntaxError => .invalid
  | .plain terms => if plainMatches fields terms then .hit else .miss
  | .legacy clauses =>
    if !covered indexed clauses then .unknown
    else if clauses.any (fun c => !c.excludes) &&
      clauses.all (fun c => clauseMatches fields c != c.excludes) then .hit
    else .miss

def page {α : Type} (newest : List α) (depth : Option Nat) (offset : Nat)
    (limit : Option Nat) : List α :=
  (((depth.map newest.take).getD newest).drop offset).take (limit.getD newest.length)

end FirestoreTextQuery
