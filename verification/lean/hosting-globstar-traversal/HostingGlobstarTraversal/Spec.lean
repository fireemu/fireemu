import Std

namespace HostingGlobstarTraversal

/-- Every split of a path into the part consumed by a globstar and the path still to match. -/
def splits : (path : List α) → List (List α × List α)
  | [] => [([], [])]
  | first :: rest => ([], first :: rest) ::
      (splits rest).map (fun (consumed, tail) => (first :: consumed, tail))

/-- A globstar may not consume a hidden component when dot matching is disabled. -/
def canConsume (hidden : α → Bool) (dot : Bool) (consumed : List α) : Bool :=
  dot || !(consumed.any hidden)

/-- Search the shortest suffix first, stopping after offering a hidden component to the suffix matcher. -/
def traverses (hidden : α → Bool) (dot : Bool) (accepts : List α → Bool) :
    List α → Bool
  | [] => accepts []
  | first :: rest => accepts (first :: rest) ||
      ((dot || !hidden first) && traverses hidden dot accepts rest)

def declarative (hidden : α → Bool) (dot : Bool) (accepts : List α → Bool)
    (path : List α) : Bool :=
  (splits path).any (fun (consumed, tail) => canConsume hidden dot consumed && accepts tail)

end HostingGlobstarTraversal
