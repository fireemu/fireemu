import Std

namespace RtdbNodeJsonShape

inductive Priority where
  | absent | number | text | invalid
  deriving BEq, DecidableEq

inductive Format where
  | plain | export
  deriving BEq, DecidableEq

abbrev Children := List (String × Int)

def canonicalIndex (name : String) : Option Nat := do
  let n ← name.toNat?
  if toString n = name && n < 2^64 then some n else none

def denseLength (indices : List Nat) : Option Nat :=
  let highest := indices.foldl max 0
  if highest < 2 * indices.length then some (highest + 1) else none

inductive View where
  | absent | failure (code : String)
  | scalar (value : Int) (priority : Priority)
  | branch (children : Children) (priority : Priority)

def hasPriority (priority : Priority) : Bool :=
  priority == .number || priority == .text

def resolvedBranch (input : List (String × Option Int)) (priority : Priority) : View :=
  if priority == .invalid then .failure "priority"
  else if input.any (fun pair => pair.1.contains '.') then .failure "key"
  else
    let children := input.filterMap (fun (key, value) => value.map (key, ·))
    if children.isEmpty then
      if hasPriority priority then .failure "data" else .absent
    else .branch children priority

def resolvedWrapper (value : Option Int) (malformed : Bool) (priority : Priority) : View :=
  if priority == .invalid then .failure "priority"
  else if malformed then .failure "data"
  else match value with
    | some n => .scalar n priority
    | none => if hasPriority priority then .failure "data" else .absent

def priorityText : Priority → List (String × String)
  | .number => [(".priority", "d2")]
  | .text => [(".priority", "slabel")]
  | _ => []

def encodeInt (n : Int) : String := "i" ++ toString n

def mapText (entries : List (String × String)) : String :=
  let ordered := entries.mergeSort (fun a b => a.1 ≤ b.1)
  "{" ++ String.intercalate "," (ordered.map fun (key, value) => key ++ "=" ++ value) ++ "}"

def fields (children : Children) : List (String × String) :=
  children.map (fun (key, value) => (key, encodeInt value))

def arrayText (children : Children) (length : Nat) : String :=
  let values := children.toArray
  let entryAt (index : Nat) := match values.find? (fun pair => pair.1 == toString index) with
    | some (_, value) => encodeInt value
    | none => "null"
  "[" ++ String.intercalate "," ((List.range length).map entryAt) ++ "]"

def render : Format → View → String
  | _, .absent => "absent"
  | _, .failure code => "!" ++ code
  | format, .scalar value priority =>
    if format == .export && hasPriority priority
    then mapText (priorityText priority ++ [(".value", encodeInt value)])
    else encodeInt value
  | .export, .branch children priority => mapText (priorityText priority ++ fields children)
  | .plain, .branch children _ =>
    let size := (children.mapM (fun pair => canonicalIndex pair.1)).bind denseLength
    match size with
    | some length => arrayText children length
    | none => mapText (fields children)

theorem empty_is_not_an_array : denseLength [] = none := by
  decide

theorem density_boundary (indices : List Nat)
    (sparse : 2 * indices.length ≤ indices.foldl max 0) :
    denseLength indices = none := by
  simp [denseLength, Nat.not_lt_of_ge sparse]

theorem dense_length_is_bounded (indices : List Nat) (length : Nat)
    (result : denseLength indices = some length) : length ≤ 2 * indices.length := by
  dsimp [denseLength] at result
  split at result
  · simp only [Option.some.injEq] at result
    omega
  · contradiction

theorem unspecified_and_explicit_priority_have_same_plain_branch
    (children : Children) (priority : Priority) :
    render .plain (.branch children priority) = render .plain (.branch children .absent) := by
  rfl

theorem null_children_do_not_change_branch
    (key : String) (keyAllowed : key.contains '.' = false)
    (rest : List (String × Option Int)) (priority : Priority) :
    resolvedBranch ((key, none) :: rest) priority = resolvedBranch rest priority := by
  simp only [resolvedBranch, List.any_cons, keyAllowed, Bool.false_or,
    List.filterMap_cons, Option.map_none]
  rfl

theorem priority_without_value_refused (priority : Priority)
    (has : hasPriority priority = true) (valid : (priority == .invalid) = false) :
    resolvedBranch [] priority = .failure "data" := by
  simp [resolvedBranch, valid, has]

/-- info: 'RtdbNodeJsonShape.empty_is_not_an_array' does not depend on any axioms -/
#guard_msgs in
#print axioms empty_is_not_an_array
/-- info: 'RtdbNodeJsonShape.density_boundary' depends on axioms: [propext] -/
#guard_msgs in
#print axioms density_boundary
/-- info: 'RtdbNodeJsonShape.dense_length_is_bounded' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms dense_length_is_bounded
/-- info: 'RtdbNodeJsonShape.unspecified_and_explicit_priority_have_same_plain_branch' depends on axioms: [propext,
 Classical.choice,
 Quot.sound] -/
#guard_msgs in
#print axioms unspecified_and_explicit_priority_have_same_plain_branch
/-- info: 'RtdbNodeJsonShape.null_children_do_not_change_branch' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms null_children_do_not_change_branch
/-- info: 'RtdbNodeJsonShape.priority_without_value_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms priority_without_value_refused

end RtdbNodeJsonShape
