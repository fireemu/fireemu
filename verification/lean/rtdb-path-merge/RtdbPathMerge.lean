import Std

namespace RtdbPathMerge

abbrev Path := List String

inductive Tree where
  | absent
  | leaf (number : Int)
  | branch (children : List (String × Tree))
  deriving Inhabited

def child (node : Tree) (key : String) : Tree :=
  match node with
  | .branch entries => ((entries.find? (fun entry => entry.1 == key)).map Prod.snd).getD .absent
  | _ => .absent

def atPath (node : Tree) : Path → Tree
  | [] => node
  | key :: tail => atPath (child node key) tail

def numberAt (node : Tree) (keys : Path) : Option Int :=
  match atPath node keys with
  | .leaf n => some n
  | _ => none

def replaceAt : Path → Tree → Tree → Tree
  | [], _, value => value
  | key :: tail, node, value =>
    let entry := replaceAt tail (child node key) value
    let siblings := match node with
      | .branch entries => entries.filter fun entry => entry.1 != key
      | _ => []
    match entry with
    | .absent =>
      match siblings with
      | [] => match node with | .leaf n => .leaf n | _ => .absent
      | _ => .branch siblings
    | present => .branch ((key, present) :: siblings)

def isPrefix : Path → Path → Bool
  | [], _ => true
  | _ :: _, [] => false
  | key :: tail, other :: suffix => key == other && isPrefix tail suffix

def pairOverlaps (a b : Path) : Bool := isPrefix a b || isPrefix b a

def anyOverlap : List Path → Bool
  | [] => false
  | path :: tail => tail.any (pairOverlaps path) || anyOverlap tail

inductive Operation where
  | put (n : Int)
  | remove
  | increment (n : Int)
  | malformed
  deriving Inhabited

inductive Refusal where
  | invalidKey | readOnly | overlapping | invalidValue
  deriving DecidableEq, Repr

/-- Recognize the path grammar of the corpus fragment. The only special path it uses is a
read-only .info path; length limits, priority and other pseudo-key placements are outside it. -/
def parsePath (raw : String) : Except Refusal Path :=
  let keys := (raw.splitOn "/").filter (· != "")
  let ordinary := if keys.head? == some ".info" then keys.drop 1 else keys
  if ordinary.any (fun key => key.toList.any
      (fun c => ".$#[]/".contains c || c.toNat < 32 || c.toNat == 127)) then .error .invalidKey
  else .ok keys

def prepare (before : Tree) (path : Path) (op : Operation) : Except Refusal (Path × Tree) :=
  if path.head? == some ".info" then .error .readOnly
  else
    match op with
    | .put n => .ok (path, .leaf n)
    | .remove => .ok (path, .absent)
    | .increment n => .ok (path, .leaf ((numberAt before path).getD 0 + n))
    | .malformed => .error .invalidValue

def transaction (before : Tree) (requests : List (String × Operation)) :
    Except Refusal Tree := do
  let paths ← requests.mapM (parsePath ∘ Prod.fst)
  if anyOverlap paths then throw .overlapping
  let prepared ← (paths.zip (requests.map Prod.snd)).mapM fun (path, op) =>
    prepare before path op
  pure (prepared.foldl (fun tree (keys, value) => replaceAt keys tree value) before)

/-- The public boundary exposes the previous snapshot on every refusal. -/
def after (before : Tree) : Except Refusal Tree → Tree
  | .ok result => result
  | .error _ => before

theorem overlapSymmetric (a b : Path) : pairOverlaps a b = pairOverlaps b a := by
  simp [pairOverlaps, Bool.or_comm]

theorem everyPathOverlapsItself (p : Path) : pairOverlaps p p = true := by
  induction p with
  | nil => rfl
  | cons head tail ih =>
    simp [pairOverlaps, isPrefix] at *
    exact ih

theorem refusedLeavesSnapshot (before : Tree) (requests : List (String × Operation))
    (err : Refusal) (h : transaction before requests = .error err) :
    after before (transaction before requests) = before := by
  rw [h]
  rfl

theorem preparingIncrementReadsSnapshot (before : Tree) (path : Path) (n : Int)
    (ordinary : path.head? ≠ some ".info") :
    prepare before path (.increment n) = .ok (path, .leaf ((numberAt before path).getD 0 + n)) := by
  simp [prepare, ordinary]

/-- info: 'RtdbPathMerge.overlapSymmetric' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms overlapSymmetric
/-- info: 'RtdbPathMerge.everyPathOverlapsItself' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms everyPathOverlapsItself
/-- info: 'RtdbPathMerge.refusedLeavesSnapshot' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms refusedLeavesSnapshot
/-- info: 'RtdbPathMerge.preparingIncrementReadsSnapshot' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms preparingIncrementReadsSnapshot

end RtdbPathMerge
