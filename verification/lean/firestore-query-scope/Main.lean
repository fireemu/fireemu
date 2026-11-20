import FirestoreQueryScope

open FirestoreQueryScope

private def relative (path : Path) : String :=
  String.intercalate "/" (path.flatMap (fun (collection, document) => [collection, document]))

private def cases (parent : Path) : List (String × Path) :=
  let direct := [
    ("same-direct", parent ++ [("selected", "target")]),
    ("other-direct", parent ++ [("different", "target")]),
    ("same-deep", parent ++ [("middle", "item"), ("selected", "target")]),
    ("other-deep", parent ++ [("selected", "item"), ("different", "target")])]
  match parent with
  | [] => direct
  | head :: tail =>
    let wrong := [
      ("wrong-document", (head.1, "sibling") :: tail ++ [("selected", "target")]),
      ("wrong-collection", ("adjacent", head.2) :: tail ++ [("selected", "target")])]
    [("self", parent)] ++ direct ++ wrong ++
      (if tail.isEmpty then [] else [("ancestor", [head])])

private def matrix : List String := Id.run do
  let mut rows := #[]
  for (kind, reach, name) in [
      ("collection", Reach.direct, some "selected"),
      ("group", Reach.descendants, some "selected"),
      ("descendants", Reach.descendants, none),
      ("children", Reach.direct, none)] do
    for (anchor, parent) in [
        ("root", []), ("shallow", [("roots", "first")]),
        ("deep", [("roots", "first"), ("buckets", "second")])] do
      for (relation, path) in cases parent do
        for namespaceLabel in ["same", "project", "database", "both"] do
          let parentText := if parent.isEmpty then "-" else relative parent
          rows := rows.push (String.intercalate "\t" [
            kind, anchor, relation, namespaceLabel, parentText, relative path,
            toString (contains reach name parent path)])
  return rows.toList

def main : IO Unit := do
  IO.println s!"# {matrix.length} cases."
  for line in matrix do IO.println line
