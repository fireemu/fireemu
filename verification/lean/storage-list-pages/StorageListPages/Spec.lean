import Std

namespace StorageListPages

structure Version where
  name : String
  generation : Nat
  live : Bool
  deriving DecidableEq, Repr

inductive Mode where
  | gcs | strict | trailing | firebase | versions
  deriving DecidableEq, Repr

inductive Key where
  | item (name : String) (generation : Option Nat)
  | commonPrefix (name : String)
  deriving DecidableEq, Repr

def Key.name : Key → String
  | .item name _ | .commonPrefix name => name

def Key.generation : Key → Nat
  | .item _ (some generation) => generation
  | _ => 0

def Key.atMost (lhs rhs : Key) : Bool :=
  lhs.name < rhs.name || lhs.name == rhs.name && lhs.generation ≤ rhs.generation

def unique [DecidableEq α] : List α → List α
  | [] => []
  | x :: xs => x :: (unique xs).filter (fun y => decide (y ≠ x))

def foldName (search delimiter name : String) : Option String :=
  let tail := String.ofList (name.toList.drop search.length)
  match delimiter, tail.splitOn delimiter with
  | "", _ => none
  | _, first :: _ :: _ => some (search ++ first ++ delimiter)
  | _, _ => none

def keyOf (mode : Mode) (search delimiter : String) (obj : Version) : Key :=
  match foldName search delimiter obj.name with
  | some folder => .commonPrefix folder
  | none => .item obj.name (if mode = .versions then some obj.generation else none)

def ordered (snapshot : List Version) (mode : Mode) (search delimiter : String) : List Key :=
  unique (((snapshot.filter fun obj => obj.name.startsWith search &&
    (mode = .versions || obj.live)).map (keyOf mode search delimiter)).mergeSort Key.atMost)

def startAt (keys : List Key) (mode : Mode) (search : String) : Option Key → List Key
  | none => keys
  | some marker =>
    match mode with
    | .firebase => keys.filter (fun key => !key.atMost marker)
    | .versions => keys.filter (marker.atMost ·)
    | .gcs => if marker ∈ keys then keys.filter (marker.atMost ·) else keys
    | .strict | .trailing =>
      if marker.name.startsWith search then keys.filter (marker.atMost ·) else keys

/-- Split the ordered projection into a page and its remaining suffix. -/
def cut (limit : Nat) (keys : List α) : List α × List α :=
  (keys.take limit, keys.drop limit)

def nextKey (mode : Mode) (page rest : List Key) : Option Key :=
  if rest.isEmpty then none
  else if mode = .firebase then page.getLast? else rest.head?

/-- An explicit fuel bound keeps the reference total when a caller supplies a zero page size. -/
def pageSequence (limit : Nat) : Nat → List α → List (List α)
  | 0, _ => []
  | _, [] => []
  | fuel + 1, keys@(_ :: _) =>
    let (page, rest) := cut limit keys
    page :: pageSequence limit fuel rest

end StorageListPages
