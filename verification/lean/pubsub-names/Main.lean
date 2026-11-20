import PubSubNames

open PubSubNames

def copies (n : Nat) (c : Char) : String := String.ofList (List.replicate n c)

def projects : List (String × String) :=
  [("plain", "p"), ("empty", ""), ("slash", "a/b"),
   ("control", "é" ++ String.singleton (Char.ofNat 133)),
   ("max", copies 255 'p'), ("long", copies 256 'p'), ("unicode", "日本")]

def ids : List (String × String) :=
  [("plain", "A0._~%+-"), ("short", "ab"), ("max", copies 255 'a'),
   ("long", copies 256 'a'), ("digit", "1ab"),
   ("alphabet", "aé"), ("reserved", "google"), ("uppercase", "Goog")]

def points (s : String) : String :=
  if s.isEmpty then "-" else String.intercalate "," (s.toList.map (toString ∘ Char.toNat))

def truth (b : Bool) : String := if b then "yes" else "no"

def fullParts : List (Kind × List String) :=
  [(.topic, ["_deleted-topic_"]), (.subscription, ["_deleted-topic_"]),
   (.topic, ["projects", "p", "subscriptions", "abc"]),
   (.subscription, ["projects", "p", "topics", "abc"]),
   (.topic, ["projects", "p", "topics", "abc", "extra"]),
   (.subscription, ["projects", "", "subscriptions", "abc"]),
   (.topic, ["Projects", "p", "topics", "abc"]),
   (.subscription, ["projects", "p", "subscriptions", ""]),
   (.topic, ["projects", "p", "topicss", "abc"])]

def main : IO Unit := do
  let kinds : List Kind := [.topic, .subscription, .snapshot]
  IO.println s!"# {kinds.length * projects.length * ids.length + fullParts.length}"
  for kind in kinds do
    for (pc, project) in projects do
      for (ic, id) in ids do
        IO.println (String.intercalate "\t"
          ["parts", kind.label, pc, ic, points project, points id,
           (projectProblem project).getD "-", (resourceProblem kind id).getD "-",
           truth (admitted kind project id)])
  for (kind, parts) in fullParts do
    IO.println (String.intercalate "\t"
      ["wire", kind.label, points (String.intercalate "/" parts), truth (acceptsParts kind parts)])
