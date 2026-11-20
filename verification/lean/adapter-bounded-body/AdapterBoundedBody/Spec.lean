import Std

namespace AB

inductive Frame where
  | data (bytes : List Char)
  | trailers
  | transportError

inductive Rejection where
  | large
  | read
  deriving DecidableEq, Repr

/-- Body payload and the number of delivered frames consumed before completion. -/
def collect : List Frame → Nat → Except Rejection (List Char) × Nat
  | [], _ => (.ok [], 0)
  | .transportError :: _, _ => (.error .read, 1)
  | .trailers :: tail, budget =>
    let (result, reads) := collect tail budget
    (result, reads + 1)
  | .data bytes :: tail, budget =>
    if bytes.length > budget then (.error .large, 1)
    else
      let (result, reads) := collect tail (budget - bytes.length)
      (result.map (bytes ++ ·), reads + 1)

end AB
