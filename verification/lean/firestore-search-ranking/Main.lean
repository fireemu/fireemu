import FirestoreSearchRanking

open FirestoreSearchRanking

def corpora : List (String × List Hit) :=
  [("empty", [⟨"ageless", 0, 0⟩]),
   ("sparse", [⟨"z", 10, 1⟩, ⟨"a", 10, 1⟩, ⟨"older-rich", 5, 5⟩, ⟨"new-miss", 11, 0⟩]),
   ("dense", [⟨"d", 9, 3⟩, ⟨"c", 10, 5⟩, ⟨"b", 10, 2⟩, ⟨"a", 4, 8⟩,
              ⟨"z", 10, 5⟩, ⟨"e", 9, 4⟩]),
   ("equal", [⟨"z", 0, 3⟩, ⟨"before", 9, 3⟩, ⟨"a", 9, 3⟩, ⟨"next", 9, 3⟩])]

def depthCases : List (String × Option Nat) :=
  [("all", none), ("zero", some 0), ("one", some 1), ("three", some 3)]

def limitCases : List (String × Option Nat) :=
  [("all", none), ("zero", some 0), ("two", some 2)]

def main : IO Unit := do
  IO.println "# shape|depth|order|offset|limit|source|page"
  for (shape, docs) in corpora do
    for (depthLabel, depth) in depthCases do
      for (order, score) in [("created", false), ("score", true)] do
        for offset in [0, 1, 8] do
          for (limitLabel, limit) in limitCases do
            let source := String.intercalate "," (docs.map fun h =>
              s!"{h.path}:{h.creation}:{h.occurrences}")
            let answer := String.intercalate "," ((page docs depth score offset limit).map Hit.path)
            IO.println s!"{shape}|{depthLabel}|{order}|{offset}|{limitLabel}|{source}|{if answer.isEmpty then "-" else answer}"
