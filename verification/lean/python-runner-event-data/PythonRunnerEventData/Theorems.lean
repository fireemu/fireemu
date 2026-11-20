import PythonRunnerEventData.Spec

namespace PySlice

theorem first_value_wins (key firstSpelling : String) (a : α) (tail : List (Member α)) :
    firstMember key (⟨key, firstSpelling, a⟩ :: tail) = some a := by simp [firstMember]

theorem ignored_member (wanted : String) (member : Member α) (tail : List (Member α))
    (h : member.name ≠ wanted) :
    firstMember wanted (member :: tail) = firstMember wanted tail := by
  simp [firstMember, h]

theorem encoded_spelling_irrelevant (wanted key a b : String) (v : α) (tail : List (Member α)) :
    firstMember wanted (⟨key, a, v⟩ :: tail) =
      firstMember wanted (⟨key, b, v⟩ :: tail) := rfl

theorem no_data_from_nonobject_event (spelling : String)
    (later : RootObject) :
    select (some (⟨"event", spelling, none⟩ :: later)) = none := by simp [select, firstMember]

theorem locally_closed_value_is_unmodified (text eventSpelling dataSpelling : String)
    (later : EventObject) (boundary : Boundary) (complete : boundary ≠ .missing) :
    select (some [⟨"event", eventSpelling, some (⟨"data", dataSpelling, ⟨text, boundary⟩⟩ :: later)⟩])
      = some text := by
  cases boundary <;> simp_all [select, firstMember]

theorem missing_delimiter_refuses_value (text eventSpelling dataSpelling : String) :
    select (some [⟨"event", eventSpelling, some [⟨"data", dataSpelling, ⟨text, .missing⟩⟩]⟩])
      = none := by simp [select, firstMember]

theorem frame_requires_data (trigger : String)
    (root : Option RootObject) :
    inFrame trigger false root = none := by simp [inFrame]

theorem frame_requires_retaining_trigger (trigger : String) (unsupported : retainsSource trigger = false)
    (root : Option RootObject) :
    inFrame trigger true root = none := by simp [inFrame, unsupported]

theorem frame_uses_same_slicer (trigger : String)
    (root : Option RootObject) (known : retainsSource trigger = true) :
    inFrame trigger true root = select root := by simp [inFrame, known]

end PySlice
