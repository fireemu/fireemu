import Std

namespace FirestoreSearchRanking

structure Hit where
  path : String
  creation : Nat
  occurrences : Nat
  deriving DecidableEq, Repr

def newest (a b : Hit) : Bool :=
  a.creation > b.creation || (a.creation == b.creation && a.path <= b.path)

def relevance (a b : Hit) : Bool :=
  a.occurrences > b.occurrences ||
    (a.occurrences == b.occurrences && newest a b)

def retrieved (input : List Hit) (depth : Option Nat) : List Hit :=
  let matched := input.filter (fun hit => hit.occurrences > 0)
  let byAge := matched.mergeSort newest
  byAge.take (depth.getD byAge.length)

def ranked (input : List Hit) (depth : Option Nat) (score : Bool) : List Hit :=
  let beforeScore := retrieved input depth
  if score then beforeScore.mergeSort relevance else beforeScore

def page (input : List Hit) (depth : Option Nat) (score : Bool)
    (offset : Nat) (limit : Option Nat) : List Hit :=
  let hits := ranked input depth score
  (hits.drop offset).take (limit.getD hits.length)

/-- Retain an ordinary candidate through any known required term or the concatenated alternative. -/
def postingCandidate (present : String → Bool) (term : String) (joined : Option String) : Bool :=
  present term || joined.any present

end FirestoreSearchRanking
