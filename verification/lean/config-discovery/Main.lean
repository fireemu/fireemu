import ConfigDiscovery

open ConfigDiscovery

def label : FileState → String
  | .absent => "-"
  | .good => "good"
  | .unreadable => "unreadable"
  | .writable => "writable"

def render : Decision → List String
  | .nothing => ["nothing", "-", "-"]
  | .ambiguous => ["ambiguous", "-", "-"]
  | .skip path => ["skipped", path, "-"]
  | .select canonical path readable =>
    [if canonical then "canonical" else "firebase", path, if readable then "good" else "unreadable"]

def row (name : String) (tree : Tree) : String :=
  String.intercalate "\t" ([name, label tree.toml, label tree.json, label tree.localFirebase,
    label tree.nearFirebase, label tree.farFirebase,
    (if tree.workingWritable then "writable" else "safe"),
    (if tree.nearWritable then "writable" else "safe")] ++ render (discover tree))

def main : IO Unit := do
  let canon : List (String × FileState × FileState) :=
    [("none", .absent, .absent), ("toml", .good, .absent),
     ("json", .absent, .good), ("both", .good, .good)]
  let localFiles : List (String × FileState) :=
    [("absent", .absent), ("readable", .good), ("unreadable", .unreadable)]
  let parentFiles : List (String × FileState) := [("absent", .absent), ("readable", .good)]
  let matrix := canon.flatMap fun (canonical, toml, json) =>
    localFiles.flatMap fun (current, localFirebase) =>
      parentFiles.flatMap fun (near, nearFirebase) =>
        parentFiles.map fun (far, farFirebase) =>
          row s!"{canonical}/{current}/{near}/{far}"
            {toml, json, localFirebase, nearFirebase, farFirebase}
  let extras :=
    [row "working-directory-writable" {toml := .good, localFirebase := .good, workingWritable := true},
     row "skip-writable-canonical" {toml := .writable, localFirebase := .good},
     row "both-before-file-checks" {toml := .writable, json := .good},
     row "stop-at-writable-parent" {nearFirebase := .good, nearWritable := true, farFirebase := .good},
     row "silent-stop-at-writable-parent-without-file" {nearWritable := true, farFirebase := .good},
     row "unreadable-nearest-is-not-replaced"
       {nearFirebase := .unreadable, farFirebase := .good}]
  let rows := matrix ++ extras
  IO.println s!"# {rows.length} cases."
  for line in rows do IO.println line
