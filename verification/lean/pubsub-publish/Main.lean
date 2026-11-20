import PubSubPublish

open PubSubPublish

def copies (n : Nat) (c : Char) : String := String.ofList (List.replicate n c)

def attributes : List (String × Attributes) :=
  [("none", []), ("single", [("a", "")]),
   ("hundred", (List.range 100).map fun n => (s!"k{n}", "")),
   ("hundred-one", (List.range 101).map fun n => (s!"k{n}", "")),
   ("empty-key", [("", "")]),
   ("key-max", [(copies 256 'k', "")]), ("key-over", [(copies 257 'k', "")]),
   ("value-max", [("a", copies 1024 'v')]), ("value-over", [("a", copies 1025 'v')]),
   ("unicode-key-max", [(copies 128 'é', "")]),
   ("unicode-key-over", [(copies 128 'é' ++ "k", "")]),
   ("unicode-value-max", [("a", copies 512 'é')]),
   ("unicode-value-over", [("a", copies 512 'é' ++ "v")]),
   ("reserved", [("goog-x", "")]), ("mixed-prefix", [("Goog-x", "")]),
   ("nul-key", [("a" ++ String.singleton (Char.ofNat 0), "")]),
   ("nul-value", [("a", "v" ++ String.singleton (Char.ofNat 0))]),
   ("long-both", [(copies 257 'k', copies 1025 'v')]),
   ("first-error", [("z", copies 1025 'v'), ("a", String.singleton (Char.ofNat 0))])]

def orderKeys : List (String × String) :=
  [("none", ""), ("one", "o"), ("max", copies 512 'é'), ("over", copies 512 'é' ++ "o"),
   ("nul", "o" ++ String.singleton (Char.ofNat 0)), ("long-nul", copies 512 'é' ++ String.singleton (Char.ofNat 0))]

def issueLabel (issue : Option Issue) : String := (issue.map reprStr).getD "ok"
  |>.replace "PubSubPublish.Issue." ""

def main : IO Unit := do
  let payloads : List (String × Nat) :=
    [("none", 0), ("one", 1), ("near", 9999999), ("max", 10000000), ("over", 10000001)]
  IO.println s!"# {payloads.length * attributes.length * orderKeys.length}"
  for (dl, data) in payloads do
    for (al, attrs) in attributes do
      for (ol, order) in orderKeys do
        IO.println (String.intercalate "\t"
          [dl, al, ol, toString data, issueLabel (admission data attrs order)])
