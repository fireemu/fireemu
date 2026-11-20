import Std

namespace SnapshotSeek

structure Message where
  id : String
  time : Int
  keep : Bool
  deriving BEq, DecidableEq

def afterBoundary (retained : Bool) (published checkpoint : Int) : Bool :=
  !retained && decide (checkpoint ≤ published)

def available (pending retained : Bool) (published checkpoint : Int) : Bool :=
  pending || afterBoundary retained published checkpoint

def insertBefore (take : α → Bool) (additional : List α) : List α → List α
  | [] => additional
  | entry :: tail =>
    if take entry then additional ++ entry :: tail
    else entry :: insertBefore take additional tail

def replay (checkpoint : Int) (admit : Message → Bool) (captured : List Message)
    (pending : List String) (target : List Message) : List String :=
  let retained := captured.map (·.id)
  let missing := captured.filter fun m => admit m && !(target.map (·.id)).contains m.id
  let reconciled := insertBefore (fun m => afterBoundary (retained.contains m.id) m.time checkpoint)
    missing target
  (reconciled.filter fun m =>
    available (pending.contains m.id) (retained.contains m.id) m.time checkpoint).map (·.id)

end SnapshotSeek
