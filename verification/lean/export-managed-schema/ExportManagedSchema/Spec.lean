import Std

namespace ManagedSchema

def remember [DecidableEq α] (seen : List α) (item : α) : List α :=
  if item ∈ seen then seen else seen ++ [item]

def distinct [DecidableEq α] (values : List α) : List α :=
  values.foldl remember []

structure Observation where
  name : String
  repeated : Bool
  codes : List Nat

def codesOf (name : String) (observations : List Observation) : List Nat :=
  (observations.filter (fun row => row.name == name)).flatMap Observation.codes

def isRepeated (name : String) (observations : List Observation) : Bool :=
  observations.any (fun row => row.name == name && row.repeated)

def infer (observations : List Observation) : List Observation :=
  (distinct (observations.map Observation.name)).map fun name =>
    ⟨name, isRepeated name observations, distinct (codesOf name observations)⟩

end ManagedSchema
