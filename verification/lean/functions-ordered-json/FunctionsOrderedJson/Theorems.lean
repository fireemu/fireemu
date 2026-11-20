import FunctionsOrderedJson.Spec

namespace FOJ

theorem first_ignores_later_same_key (head : α) (tail : List (String × α)) (key : String) :
    first ((key, head) :: tail) key = some head := by
  simp [first]

theorem last_prefers_appended_key (members : List (String × α)) (key : String) (found : α) :
    last (members ++ [(key, found)]) key = some found := by
  simp [last, first]

theorem duplicates_choose_opposite_ends (key : String) (earlier later : α) :
    first [(key, earlier), (key, later)] key = some earlier ∧
      last [(key, earlier), (key, later)] key = some later := by
  simp [first, last]

theorem empty_object_has_no_internal_whitespace (pretty : Bool) (depth : Nat) :
    objectText pretty depth (fun (v : String) => v) [] = "{}" := by
  rfl

theorem append_member_preserves_printed_order (key1 key2 val1 val2 : String) :
    objectText true 0 (fun v => v) [(key1, val1), (key2, val2)] =
      "{\n  " ++ quoted key1 ++ ": " ++ val1 ++ ",\n  " ++ quoted key2 ++ ": " ++ val2 ++ "\n}" := by
  simp [objectText, frame, padding, String.append_assoc]

end FOJ
