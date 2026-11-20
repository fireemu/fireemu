import AuthQueryIndex

open AuthQueryIndex

def fillers : List Account :=
  (List.range 32).map fun n =>
    let key := "x" ++ (if n < 10 then "0" else "") ++ toString n
    ⟨key, key, "", "", "zz"⟩

def base (scope : String) : List Account :=
  if scope = "root" then
    [⟨"a", "a", "ος@example.com", "+12025550001", "Zed"⟩,
     ⟨"b", "b", "ος@example.com", "+12025550001", "Amy"⟩,
     ⟨"c", "c", "ki̇@example.com", "+12025550002", "Amy"⟩] ++ fillers
  else
    [⟨"a", "a", "user@example.com", "+12025550002", "Zed"⟩] ++ fillers

def stageRows (stage scope : String) : List Account :=
  if scope = "root" && (stage = "raw" || stage = "cloned") then
    (base scope).map fun user =>
      if user.key = "a" then { user with id := "other", email := "Kİ@example.com", phone := "+12025550002" }
      else user
  else if scope = "root" && stage = "tracked" then
    ((base scope).filter (·.key != "b")).map fun user =>
      if user.key = "a" then { user with email := "user@example.com", phone := "+12025550003" }
      else user
  else base scope

def predicates : String → List Expr
  | "all" => []
  | "sigma" => [.email "ΟΣ@example.com"]
  | "medial" => [.email "οσ@example.com"]
  | "kelvin" => [.email "Kİ@EXAMPLE.COM"]
  | "ascii" => [.email "USER@example.com"]
  | "phone" => [.phone "+12025550001"]
  | "changedPhone" => [.phone "+12025550002"]
  | "rawId" => [.uid "other"]
  | "mixed" => [.email "ΟΣ@example.com", .phone "+12025550002", .uid "a", .uid "a"]
  | _ => [.uid "A"]

def main : IO Unit := do
  IO.println "# stage|scope|predicate|sort|direction|page|count|ids"
  for stage in ["clean", "raw", "cloned", "tracked", "reset"] do
    for scope in ["root", "tenant"] do
      let rows := stageRows stage scope
      for predicate in ["all", "sigma", "medial", "kelvin", "ascii", "phone", "changedPhone", "rawId", "mixed", "miss"] do
        let selection := scan rows (predicates predicate)
        for sort in ["id", "name"] do
          for direction in ["asc", "desc"] do
            let sorted := project selection sort (direction == "desc")
            for (name, offset, limit) in [("first", 0, 2), ("second", 1, 2), ("none", 0, 0), ("all", 0, 1000)] do
              let ids := String.intercalate "," (((sorted.drop offset).take limit).map Account.id)
              IO.println (String.intercalate "|" [stage, scope, predicate, sort, direction, name,
                toString selection.length, if ids.isEmpty then "-" else ids])
