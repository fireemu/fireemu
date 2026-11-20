import FirestoreQueryDnf.Spec

namespace FirestoreQueryDnf

theorem product_associative (left middle right : Dnf) :
    product (product left middle) right = product left (product middle right) := by
  simp [product, List.flatMap_assoc, List.flatMap_map, List.map_flatMap, Function.comp_def,
    List.map_map, List.append_assoc]

theorem product_branch_count (left right : Dnf) :
    (product left right).length = left.length * right.length := by
  induction left with
  | nil => simp [product]
  | cons head tail ih =>
    change ((right.map (head ++ ·)) ++ product tail right).length =
      (tail.length + 1) * right.length
    simp [ih, Nat.add_mul, Nat.add_comm]

private theorem prefixed_occurrences (head : Term) (terms : Dnf) :
    occurrences (terms.map (head ++ ·)) = head.length * terms.length + occurrences terms := by
  induction terms with
  | nil => simp [occurrences]
  | cons first later ih =>
    simp only [List.map_cons, occurrences, List.sum_cons, List.length_append, List.length_cons]
    unfold occurrences at ih
    rw [ih, Nat.mul_succ]
    ac_rfl

theorem product_occurrences (left right : Dnf) :
    occurrences (product left right) =
      occurrences left * right.length + left.length * occurrences right := by
  induction left with
  | nil => simp [product, occurrences]
  | cons head tail ih =>
    change occurrences (right.map (head ++ ·) ++ product tail right) =
      occurrences (head :: tail) * right.length + (tail.length + 1) * occurrences right
    have append (a b : Dnf) : occurrences (a ++ b) = occurrences a + occurrences b := by
      simp [occurrences, List.sum_append]
    rw [append, prefixed_occurrences, ih]
    simp only [occurrences, List.map_cons, List.sum_cons, Nat.add_mul, Nat.one_mul]
    ac_rfl

private theorem singleton_occurrences (atoms : List Atom) :
    occurrences (atoms.map (fun atom => [atom])) = atoms.length := by
  induction atoms with
  | nil => rfl
  | cons atom tail ih =>
    simp only [List.map_cons, occurrences, List.sum_cons, List.length_cons, List.length_nil]
    unfold occurrences at ih
    rw [ih]
    omega

theorem statistics_spec (expr : Expression) :
    (statistics expr).disjunctions = (materialize expr).length ∧
      (statistics expr).occurrences = occurrences (materialize expr) := by
  induction expr with
  | atom value => simp [statistics, materialize, singleton_occurrences]
  | unconstrained => simp [statistics, materialize, occurrences]
  | impossible => simp [statistics, materialize, occurrences]
  | both left right ihLeft ihRight =>
    simp [statistics, materialize, product_branch_count, product_occurrences,
      ihLeft.1, ihLeft.2, ihRight.1, ihRight.2]
  | either left right ihLeft ihRight =>
    simp [statistics, materialize, occurrences, List.sum_append,
      ihLeft.1, ihLeft.2, ihRight.1, ihRight.2]

theorem capped_add (cap a b : Nat) :
    min cap (min cap a + min cap b) = min cap (a + b) := by
  by_cases ha : a ≤ cap
  · by_cases hb : b ≤ cap
    · simp [Nat.min_eq_right ha, Nat.min_eq_right hb]
    · have bc : cap ≤ b := by omega
      have raw : cap ≤ a + b := by omega
      simp [Nat.min_eq_right ha, Nat.min_eq_left bc, Nat.min_eq_left raw]
  · have ac : cap ≤ a := by omega
    have raw : cap ≤ a + b := by omega
    simp [Nat.min_eq_left ac, Nat.min_eq_left raw]

theorem capped_multiply (cap a b : Nat) :
    min cap (min cap a * min cap b) = min cap (a * b) := by
  rcases Classical.em (cap = 0) with rfl | positiveCap
  · simp
  rcases Classical.em (a = 0) with rfl | positiveA
  · simp
  rcases Classical.em (b = 0) with rfl | positiveB
  · simp
  by_cases ha : a ≤ cap
  · by_cases hb : b ≤ cap
    · simp [Nat.min_eq_right ha, Nat.min_eq_right hb]
    · have bc : cap ≤ b := by omega
      have aPos : 0 < a := by omega
      have raw : cap ≤ a * b := Nat.le_trans bc (Nat.le_mul_of_pos_left b aPos)
      have clipped : cap ≤ a * cap := Nat.le_mul_of_pos_left cap aPos
      simp [Nat.min_eq_right ha, Nat.min_eq_left bc, Nat.min_eq_left raw, Nat.min_eq_left clipped]
  · have ac : cap ≤ a := by omega
    have bPos : 0 < b := by omega
    have capPos : 0 < cap := by omega
    have clippedB : 0 < min cap b := Nat.lt_min.mpr ⟨capPos, bPos⟩
    have raw : cap ≤ a * b := Nat.le_trans ac (Nat.le_mul_of_pos_right a bPos)
    have clipped : cap ≤ cap * min cap b := Nat.le_mul_of_pos_right cap clippedB
    simp [Nat.min_eq_left ac, Nat.min_eq_left raw, Nat.min_eq_left clipped]

theorem saturating_fold_counts (expr : Expression) :
    saturatedFold expr = disjunctionCount expr := by
  induction expr with
  | atom atom => simp [saturatedFold, disjunctionCount, statistics]
  | unconstrained => simp [saturatedFold, disjunctionCount, statistics, maxCount]
  | impossible => simp [saturatedFold, disjunctionCount, statistics]
  | both left right ihLeft ihRight =>
    simp [saturatedFold, disjunctionCount, statistics, ihLeft, ihRight, capped_multiply]
  | either left right ihLeft ihRight =>
    simp [saturatedFold, disjunctionCount, statistics, ihLeft, ihRight, capped_add]

theorem component_filters_within_limit (expr : Expression) (orders : Nat) (parent : Bool)
    (h : (materialize expr).length ≤ materializationLimit) :
    (componentCount expr orders parent).filters = occurrences (materialize expr) := by
  simp [componentCount, (statistics_spec expr).1, (statistics_spec expr).2, Nat.not_lt_of_ge h]

theorem component_filters_above_limit (expr : Expression) (orders : Nat) (parent : Bool)
    (h : materializationLimit < (statistics expr).disjunctions) :
    (componentCount expr orders parent).filters = maxCount / 4 := by
  simp [componentCount, h]

end FirestoreQueryDnf
