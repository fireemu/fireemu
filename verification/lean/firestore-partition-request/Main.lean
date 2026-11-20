import FirestorePartitionRequest

open FirestorePartitionRequest

def scopes : List (String × Scope) :=
  [("collection", .collection), ("group", .group), ("kindless", .kindless), ("children", .children)]

def bits : List (String × Bool) := [("off", false), ("on", true)]

def main : IO Unit := do
  IO.println "# scope|strict|limit|offset|projection|start|finish|ordered|result"
  for (scopeTag, scope) in scopes do
    for (strictTag, strict) in bits do
      for (limitTag, limit) in bits do
        for (offsetTag, offset) in bits do
          for (projectionTag, projection) in bits do
            for (startTag, start) in bits do
              for (finishTag, finish) in bits do
                for (orderedTag, ordered) in bits do
                  let shape : Shape := ⟨scope, strict, limit, offset, projection, start, finish, ordered⟩
                  let result := match FirestorePartitionRequest.decide shape with
                    | .ok true => "split"
                    | .ok false => "no-split"
                    | .error r => message r
                  IO.println <| String.intercalate "|" [scopeTag, strictTag, limitTag, offsetTag,
                    projectionTag, startTag, finishTag, orderedTag, result]
