import PythonRunnerDuplicateMembers.Spec

namespace PyDuplicate

theorem lookup_upsert (members : List Member) (key value : String) :
    lookup key (upsert key value members) = some value := by
  induction members with
  | nil => simp [lookup, upsert]
  | cons member rest ih =>
    by_cases h : member.1 = key <;> simp [lookup, upsert, h, ih]

theorem other_lookup_unchanged (members : List Member) (other key value : String) (hne : key ≠ other) :
    lookup other (upsert key value members) = lookup other members := by
  induction members with
  | nil => simp [lookup, upsert, hne]
  | cons member rest ih =>
    by_cases h : member.1 = key <;> simp [lookup, upsert, h, hne, ih]

theorem key_order_upsert (members : List Member) (key value : String) :
    (upsert key value members).map Prod.fst =
      if key ∈ members.map Prod.fst then members.map Prod.fst else members.map Prod.fst ++ [key] := by
  induction members with
  | nil => simp [upsert]
  | cons member rest ih =>
    by_cases h : member.1 = key
    · simp [upsert, h]
    · by_cases hm : key ∈ rest.map Prod.fst <;> simp [upsert, h, Ne.symm h, hm, ih]

theorem decoded_duplicate_keeps_first_position (raw : List Member) (key value : String)
    (present : key ∈ (decode raw).map Prod.fst) :
    (decode (raw ++ [(key, value)])).map Prod.fst = (decode raw).map Prod.fst := by
  simp [decode, List.foldl_append, key_order_upsert, decode] at present ⊢
  exact present

theorem decoded_duplicate_uses_last_lexeme (raw : List Member) (key value : String) :
    lookup key (decode (raw ++ [(key, value)])) = some value := by
  simp [decode, lookup_upsert, List.foldl_append]

end PyDuplicate
