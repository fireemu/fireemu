import Std

namespace PyDuplicate

abbrev Member := String × String

def upsert (key value : String) : List Member → List Member
  | [] => [(key, value)]
  | member :: rest =>
    if member.1 = key then (key, value) :: rest else member :: upsert key value rest

def lookup (key : String) : List Member → Option String
  | [] => none
  | member :: rest => if member.1 = key then some member.2 else lookup key rest

def decode (raw : List Member) : List Member :=
  raw.foldl (fun members (key, value) => upsert key value members) []

def storageRank (key : String) : Nat :=
  match key with
  | "kind" => 0
  | "id" => 1
  | "selfLink" => 2
  | "name" => 3
  | "bucket" => 4
  | "generation" => 5
  | "metageneration" => 6
  | "contentType" => 7
  | "timeCreated" => 8
  | "updated" => 9
  | "storageClass" => 10
  | "timeStorageClassUpdated" => 11
  | "size" => 12
  | "md5Hash" => 13
  | "mediaLink" => 14
  | "crc32c" => 15
  | "etag" => 16
  | _ => 17

def layout (mode : String) (members : List Member) : String :=
  let quoted := fun key => "\"" ++ key ++ "\""
  let entry := fun spacer (member : Member) => quoted member.1 ++ ":" ++ spacer ++ member.2
  if mode = "storage" then
    let sorted := members.mergeSort (fun a b => storageRank a.1 < storageRank b.1 || (storageRank a.1 == storageRank b.1 && a.1 ≤ b.1))
    "{\n  " ++ String.intercalate ",\n  " (sorted.map (entry " ")) ++ "\n}\n"
  else
    let ordered := if mode = "pubsub" then members.mergeSort (fun a b => a.1 ≤ b.1) else members
    "{" ++ String.intercalate "," (ordered.map (entry "")) ++ "}" ++
      (if mode = "pubsub" then "\n" else "")

end PyDuplicate
