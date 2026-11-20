import FirestoreFieldPath.Spec

namespace FirestoreFieldPath

theorem quoted_content_recovers (chars remainder : List Char) :
    quotedContent (escape chars ++ tick :: remainder) false = some (chars, remainder) := by
  have slash_not_tick : slash ≠ tick := by decide
  induction chars with
  | nil => simp [escape, quotedContent]
  | cons c cs ih =>
    by_cases ht : c = tick
    · subst c
      simp [escape, needsEscape, quotedContent, slash_not_tick, ih]
    · by_cases hs : c = slash
      · subst c
        simp [escape, needsEscape, quotedContent, slash_not_tick, ih]
      · have ticks : (c == tick) = false := beq_eq_false_iff_ne.mpr ht
        have slashes : (c == slash) = false := beq_eq_false_iff_ne.mpr hs
        simp [escape, needsEscape, quotedContent, ticks, slashes, ht, hs, ih]

theorem one_segment_bytes (s : String) : pathBytes [s] = s.utf8ByteSize := by
  simp [pathBytes]

theorem append_segment_bytes (head : String) (tail : List String) (s : String) :
    pathBytes ((head :: tail) ++ [s]) = pathBytes (head :: tail) + 1 + s.utf8ByteSize := by
  simp [pathBytes, List.sum_append]
  omega

theorem validated_path_fits (segments : List String)
    (h : validate segments = .ok ()) : pathBytes segments ≤ limit := by
  cases segments with
  | nil => simp [validate] at h
  | cons head tail =>
    cases first : firstFault (head :: tail) 0 with
    | some fault => simp [validate, first] at h
    | none =>
      by_cases fits : pathBytes (head :: tail) ≤ limit
      · exact fits
      · simp [validate, first, fits] at h

end FirestoreFieldPath
