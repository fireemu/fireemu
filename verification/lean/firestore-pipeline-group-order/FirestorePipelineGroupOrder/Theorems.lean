import FirestorePipelineGroupOrder.Spec

namespace FirestorePipelineGroupOrder

theorem materialization_keeps_key (row : List Cell) : key (row.map materialize) = key row := by
  induction row with
  | nil => rfl
  | cons x xs ih =>
    have head : familyKey (materialize x) = familyKey x := by cases x <;> rfl
    simp only [key, List.map_cons]
    rw [head]
    exact congrArg (List.cons (familyKey x)) ih

theorem insertion_preserves_head (row : List Cell) (g : Group) (gs : List Group) :
    (insert row (g :: gs)).head?.map Group.leader = some g.leader := by
  by_cases h : key row = key g.leader <;> simp [insert, h]

theorem insertion_counts_one (row : List Cell) (gs : List Group) :
    count (insert row gs) = count gs + 1 := by
  induction gs with
  | nil => rfl
  | cons g gs ih =>
    by_cases h : key row = key g.leader <;> simp [insert, count, h, ih] <;> omega

theorem cardinality_from_accumulator (rows : List (List Cell)) (initial : List Group) :
    count (rows.foldl (fun gs row => insert row gs) initial) = count initial + rows.length := by
  induction rows generalizing initial with
  | nil => simp
  | cons row tail ih =>
    simp [ih, insertion_counts_one]
    omega

theorem grouped_cardinality (arity : Nat) (rows : List (List Cell)) :
    count (groups arity rows) = rows.length := by
  by_cases h : arity = 0 <;> simp [groups, h, count, partition, cardinality_from_accumulator]

theorem no_alias_group_on_empty_input : groups 0 [] = [⟨[], 0⟩] := by rfl

theorem no_distinct_keys_on_empty_input : partition [] = [] := by rfl

end FirestorePipelineGroupOrder
