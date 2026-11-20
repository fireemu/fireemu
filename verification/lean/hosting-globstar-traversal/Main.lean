import HostingGlobstarTraversal

open HostingGlobstarTraversal

def paths : Nat → List (List Bool)
  | 0 => [[]]
  | n + 1 => (paths n).flatMap (fun tail => [false :: tail, true :: tail])

def renderPath (path : List Bool) : String :=
  String.ofList (path.map fun hidden => if hidden then 'h' else 'v')

def main : IO Unit := do
  IO.println "# dot|path|suffix-length-bitset|match"
  for length in [0:4] do
    for path in paths length do
      for dot in [false, true] do
        for mask in [0:2 ^ (length + 1)] do
          let expect := declarative id dot (fun suffix => mask.testBit suffix.length) path
          IO.println s!"{dot}|{renderPath path}|{mask}|{expect}"
