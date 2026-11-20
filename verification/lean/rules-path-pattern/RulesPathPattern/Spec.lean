import Std

namespace RulesPathPattern

inductive Version where
  | one | two
  deriving DecidableEq

inductive Layout where
  | single | nested | trailing | leading
  deriving DecidableEq

structure Captures where
  id : String
  nestedId : Option String := none
  recursive : Option (List String) := none
  deriving DecidableEq

/-- This fragment contains one recursive wildcard in a single match header. Version 1
permits it only at the end; version 2 also permits it before a fixed suffix. -/
def admissible (version : Version) (layout : Layout) : Bool :=
  version == .two || layout != .leading

/-- The path excludes the enclosing database prefix. Every match consumes the whole path.
The leading wildcard is characterized by a suffix decomposition, not an ordered search. -/
def captures (version : Version) (layout : Layout) (path : List String) : Option Captures :=
  match layout, path with
  | .single, ["items", id] => some ⟨id, none, none⟩
  | .nested, ["items", id, "notes", note] => some ⟨id, some note, none⟩
  | .trailing, "items" :: id :: rest =>
    if version == .two || !rest.isEmpty then some ⟨id, none, some rest⟩ else none
  | .leading, segments =>
    if version == .two then
      match segments.reverse with
      | id :: "items" :: reversed => some ⟨id, none, some reversed.reverse⟩
      | _ => none
    else none
  | _, _ => none

theorem single_exact (id : String) :
    captures .two .single ["items", id] = some ⟨id, none, none⟩ := rfl

theorem single_rejects_descendants (id segment : String) (tail : List String) :
    captures .two .single ("items" :: id :: segment :: tail) = none := by
  simp [captures]

theorem nested_binds_both (version : Version) (id note : String) :
    captures version .nested ["items", id, "notes", note] = some ⟨id, some note, none⟩ := rfl

theorem trailing_captures_all (id : String) (tail : List String) :
    captures .two .trailing ("items" :: id :: tail) = some ⟨id, none, some tail⟩ := rfl

theorem trailing_v1_needs_a_segment (id : String) (tail : List String) :
    captures .one .trailing ("items" :: id :: tail) =
    if tail = [] then none else some ⟨id, none, some tail⟩ := by
  cases tail <;> rfl

theorem leading_preserves_prefix_and_suffix (leadingPath : List String) (id : String) :
    captures .two .leading (leadingPath ++ ["items", id]) = some ⟨id, none, some leadingPath⟩ := by
  simp only [captures, beq_self_eq_true, ↓reduceIte, List.reverse_append]
  simp [List.reverse_cons]

theorem v1_rejects_leading :
    admissible .one .leading = false := rfl

end RulesPathPattern
