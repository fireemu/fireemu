import Std

namespace RulesSetValues

/-- A dyadic fragment of concrete Rules scalars. A float is exact in units of one half. -/
inductive Scalar where
  | integer (value : Int)
  | halfUnits (value : Int)
  | negativeZero
  | nan
  | null
  | bool (value : Bool)
  | string (value : String)
  deriving DecidableEq

inductive Key where
  | number (halfUnits : Int)
  | null
  | bool (value : Bool)
  | string (value : String)
  deriving DecidableEq

def key : Scalar → Option Key
  | .integer x => some (.number (2 * x))
  | .halfUnits x => some (.number x)
  | .negativeZero => some (.number 0)
  | .nan => none
  | .null => some .null
  | .bool x => some (.bool x)
  | .string x => some (.string x)

def equal (left right : Scalar) : Bool :=
  match key left, key right with
  | some a, some b => decide (a = b)
  | _, _ => false

theorem equal_iff (left right : Scalar) :
    equal left right = true ↔ ∃ k, key left = some k ∧ key right = some k := by
  cases hl : key left <;> cases hr : key right <;> simp [equal, hl, hr, eq_comm]

theorem integral_float_alias (x : Int) : equal (.integer x) (.halfUnits (2 * x)) = true := by
  simp [equal, key]

theorem nan_never_member_of_pair (x : Scalar) : equal .nan x = false := by
  cases x <;> rfl

theorem equal_symm {a b : Scalar} (h : equal a b = true) : equal b a = true := by
  obtain ⟨k, ha, hb⟩ := (equal_iff a b).1 h
  exact (equal_iff b a).2 ⟨k, hb, ha⟩

theorem equal_trans {a b c : Scalar} (hab : equal a b = true) (hbc : equal b c = true) :
    equal a c = true := by
  obtain ⟨x, ha, hb⟩ := (equal_iff a b).1 hab
  obtain ⟨y, hb', hc⟩ := (equal_iff b c).1 hbc
  have hxy : x = y := Option.some.inj (hb.symm.trans hb')
  exact (equal_iff a c).2 ⟨x, ha, hxy ▸ hc⟩

def member (value : Scalar) (items : List Scalar) : Bool := items.any (equal value)

theorem member_nil (value : Scalar) : member value [] = false := rfl

theorem member_cons (value head : Scalar) (tail : List Scalar) :
    member value (head :: tail) = (equal value head || member value tail) := rfl

theorem member_iff (value : Scalar) (items : List Scalar) :
    member value items = true ↔ ∃ item ∈ items, equal value item = true := List.any_eq_true

theorem nan_never_member (items : List Scalar) : member .nan items = false := by
  induction items with
  | nil => rfl
  | cons x xs ih => simp [member_cons, nan_never_member_of_pair, ih]

def insert (items : List Scalar) (value : Scalar) : List Scalar :=
  if member value items then items else items ++ [value]

def distinct (items : List Scalar) : List Scalar := items.foldl insert []

theorem member_append (value : Scalar) (left right : List Scalar) :
    member value (left ++ right) = (member value left || member value right) := by
  simp [member, List.any_append]

theorem member_insert (probe value : Scalar) (items : List Scalar) :
    member probe (insert items value) = (member probe items || equal probe value) := by
  cases h : member value items
  · simp [insert, h, member_append, member_cons, member_nil]
  · simp only [insert, h, ↓reduceIte]
    cases hp : equal probe value
    · simp
    · obtain ⟨x, hx, hvx⟩ := (member_iff value items).1 h
      have hm := (member_iff probe items).2 ⟨x, hx, equal_trans hp hvx⟩
      simp [hm]

theorem member_fold (probe : Scalar) (seen items : List Scalar) :
    member probe (items.foldl insert seen) = (member probe seen || member probe items) := by
  induction items generalizing seen with
  | nil => simp [member_nil]
  | cons x xs ih =>
    rw [List.foldl_cons, ih, member_insert]
    simp [member_cons, Bool.or_assoc]

theorem member_distinct (probe : Scalar) (items : List Scalar) :
    member probe (distinct items) = member probe items := by
  rw [distinct, member_fold]
  rfl

def union (left right : List Scalar) : List Scalar := distinct (left ++ right)

theorem union_membership (probe : Scalar) (left right : List Scalar) :
    member probe (union left right) = (member probe left || member probe right) := by
  simp [union, member_distinct, member_append]

def intersection (left right : List Scalar) : List Scalar :=
  distinct (left.filter fun item => member item right)

def difference (left right : List Scalar) : List Scalar :=
  distinct (left.filter fun item => !member item right)

theorem member_congr {a b : Scalar} (h : equal a b = true) (items : List Scalar) :
    member a items = member b items := by
  induction items with
  | nil => rfl
  | cons x xs ih =>
    have ex : equal a x = equal b x := by
      cases ha : equal a x <;> cases hb : equal b x <;> try rfl
      · have := equal_trans h hb
        simp [ha] at this
      · have := equal_trans (equal_symm h) ha
        simp [hb] at this
    simp [member_cons, ex, ih]

theorem filter_membership (probe : Scalar) (left right : List Scalar) (keep : Bool → Bool) :
    member probe (left.filter (fun value => keep (member value right))) =
    (member probe left && keep (member probe right)) := by
  induction left with
  | nil => rfl
  | cons x xs ih =>
    cases hx : equal probe x
    · cases hk : keep (member x right) <;> simp [hk, hx, member_cons, ih]
    · have he := member_congr hx right
      cases hk : keep (member probe right)
      · have hr : keep (member x right) = false := he ▸ hk
        simp [hr, hk, member_cons, ih]
      · have hr : keep (member x right) = true := he ▸ hk
        simp [hr, hx, member_cons]

theorem intersection_membership (probe : Scalar) (left right : List Scalar) :
    member probe (intersection left right) = (member probe left && member probe right) := by
  rw [intersection, member_distinct]
  exact filter_membership probe left right id

theorem difference_membership (probe : Scalar) (left right : List Scalar) :
    member probe (difference left right) = (member probe left && !member probe right) := by
  rw [difference, member_distinct]
  exact filter_membership probe left right not

theorem repeated_nan_retained :
    distinct [.nan, .nan] = [.nan, .nan] := by decide

end RulesSetValues
