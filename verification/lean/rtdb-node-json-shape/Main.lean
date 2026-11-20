import RtdbNodeJsonShape

open RtdbNodeJsonShape

def childShapes : List (String × List (String × Option Int)) := [
  ("dense", [("0", some 1), ("2", some 2)]),
  ("sparse", [("0", some 1), ("5", some 2)]),
  ("threshold", [("0", some 1), ("4", some 2)]),
  ("empty", []),
  ("nulls", [("0", none), ("1", some 2), ("2", none)]),
  ("noncanonical", [("0", some 1), ("01", some 2), ("١", some 3), ("-1", some 4)]),
  ("huge", [("18446744073709551615", some 1), ("18446744073709551616", some 2)]),
  ("forbidden", [("0", some 1), ("invalid.key", none)])]

def priorities : List (String × Priority) :=
  [("none", .absent), ("number", .number), ("string", .text), ("invalid", .invalid)]

def formats : List (String × Format) :=
  [("plain", .plain), ("export", .export)]

def view (container shape : String) (children : List (String × Option Int))
    (priority : Priority) : View :=
  match container with
  | "object" => resolvedBranch children priority
  | "array" => resolvedBranch (children.zipIdx.map (fun ((_, value), i) =>
      (toString i, value))) .absent
  | "wrapper" => resolvedWrapper (if shape == "empty" then none else some 1)
      (shape == "forbidden" || shape == "sparse") priority
  | _ => .failure "server"

def main : IO Unit := do
  IO.println "# Container\tChildren\tPriority\tOutput\tExpected"
  for container in ["object", "array", "wrapper", "server"] do
    for (shape, children) in childShapes do
      for (p, priority) in priorities do
        for (output, format) in formats do
          IO.println (String.intercalate "\t" [container, shape, p, output,
            render format (view container shape children priority)])
