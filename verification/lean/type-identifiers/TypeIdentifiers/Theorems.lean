import TypeIdentifiers.Spec

namespace TI

theorem admits_within_limit (k : Kind) (s : String) (h : refusal k s = none) :
    s.utf8ByteSize ≤ k.limit := by
  unfold refusal at h
  split at h
  · cases h
  · split at h
    · cases h
    · omega

theorem document_collection_same (text : String) :
    refusal .collection text = refusal .document text := by
  rfl

theorem default_database_but_not_project :
    refusal .database "(default)" = none ∧ refusal .project "(default)" = some (.invalidCharacter 0) :=
  by decide

theorem slash_precedes_control_on_path_segments (text : String)
    (h : text.contains '/' = true) : pathSegment text = some .slash := by
  simp [pathSegment, h]

theorem offsets_count_utf8_bytes :
    firstOffset isControl 0 ['é', Char.ofNat 1] = some 2 := by decide

end TI
