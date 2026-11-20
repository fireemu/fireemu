import StorageGlob.Spec

namespace StorageGlob

theorem literal_is_exact (c : Char) (name : List Char) :
    accepts [Atom.literal c] name = true ↔ name = [c] := by
  constructor
  · intro h
    obtain ⟨i, _, accepted⟩ := List.any_eq_true.mp h
    obtain ⟨a, b⟩ := Bool.and_eq_true_iff.mp accepted
    have htake : name.take i = [c] := by simpa [consumes] using a
    have hdrop : name.drop i = [] := by simpa [accepts] using b
    have hjoin := List.take_append_drop i name
    simpa [htake, hdrop] using hjoin.symm
  · rintro rfl
    refine List.any_eq_true.mpr ⟨1, by simp, ?_⟩
    simp [accepts, consumes]

theorem question_cannot_match_slash : consumes .question ['/'] = false := by decide

theorem range_cannot_match_slash (ranges : List (Char × Char)) (negated : Bool) :
    consumes (.class ranges negated) ['/'] = false := by
  simp [consumes, nonSlash]

theorem segment_cannot_consume_any_slash (name : List Char)
    (matched : consumes .segmentStar name = true) : '/' ∉ name := by
  intro m
  have slash := (List.all_eq_true.mp matched) '/' m
  simp [nonSlash] at slash

theorem directory_star_can_skip (suffix : List Atom) (name : List Char)
    (matched : accepts suffix name = true) : accepts (.directoryStar :: suffix) name = true := by
  refine List.any_eq_true.mpr ⟨0, List.mem_range.mpr (by omega), ?_⟩
  simpa [consumes] using matched

theorem directory_star_requires_slash (head : Char) (tail : List Char) :
    consumes .directoryStar (head :: tail) = true ↔ List.getLast? (head :: tail) = some '/' := by
  simp [consumes]

theorem recursive_star_generalizes_segment (suffix : List Atom) (name : List Char)
    (matched : accepts (.segmentStar :: suffix) name = true) :
    accepts (.recursiveStar :: suffix) name = true := by
  obtain ⟨i, valid, run⟩ := List.any_eq_true.mp matched
  refine List.any_eq_true.mpr ⟨i, valid, ?_⟩
  simpa [consumes] using (Bool.and_eq_true_iff.mp run).2

theorem alternatives_distribute (left right : List (List Atom)) (name : List Char) :
    matchesChoice (left ++ right) name = (matchesChoice left name || matchesChoice right name) := by
  simp [matchesChoice, List.any_append]

theorem scalar_not_utf8_byte : accepts [.question] "🌸".toList = true := by decide
theorem two_scalars_do_not_match_one : accepts [.question] "é".toList = false := by decide

end StorageGlob
