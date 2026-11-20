import RunnerLogBounds.Spec

namespace RunnerLogBounds

theorem bytes_cons (scalar : Char) (rest : List Char) :
    bytes (scalar :: rest) = scalar.utf8Size + bytes rest := rfl

theorem bytes_append (first second : List Char) :
    bytes (first ++ second) = bytes first + bytes second := by
  simp [bytes, List.sum_append]

theorem clip_fits (budget : Nat) (input : List Char) :
    bytes (clip budget input) ≤ budget := by
  induction input generalizing budget with
  | nil => simp [clip, bytes]
  | cons c rest ih =>
    by_cases h : c.utf8Size ≤ budget
    · have hr := ih (budget - c.utf8Size)
      simp only [clip, ite_eq_left h, bytes_cons]
      omega
    · simp [clip, h, bytes]

theorem clip_is_prefix (budget : Nat) (input : List Char) :
    ∃ tail, input = clip budget input ++ tail := by
  induction input generalizing budget with
  | nil => exact ⟨[], rfl⟩
  | cons c rest ih =>
    by_cases h : c.utf8Size ≤ budget
    · obtain ⟨tail, heq⟩ := ih (budget - c.utf8Size)
      exact ⟨tail, by simp only [clip, ite_eq_left h, List.cons_append, List.cons.injEq, true_and]; exact heq⟩
    · exact ⟨c :: rest, by simp [clip, h]⟩

theorem clip_longest (front tail : List Char) (budget : Nat) (fits : bytes front ≤ budget) :
    front.length ≤ (clip budget (front ++ tail)).length := by
  induction front generalizing budget with
  | nil => simp
  | cons c rest ih =>
    rw [bytes_cons] at fits
    have hc : c.utf8Size ≤ budget := by omega
    have hr : bytes rest ≤ budget - c.utf8Size := by omega
    simpa only [List.cons_append, clip, ite_eq_left hc, List.length_cons, Nat.succ_le_succ_iff] using
      ih (budget - c.utf8Size) hr

theorem bound_fits (budget : Nat) (input : List Char) :
    bytes (bound budget input) ≤ budget := by
  unfold bound
  split
  · assumption
  · split
    · exact clip_fits _ _
    · rw [bytes_append]
      have hb := clip_fits (budget - bytes marker) input
      omega

theorem exact_copy_when_fitting (budget : Nat) (input : List Char) (fits : bytes input ≤ budget) :
    bound budget input = input := by simp [bound, fits]

theorem normalization_examples :
    normalize [0xd83d, 0xde00] = [Char.ofNat 0x1f600] ∧
    normalize [0xd800, 65, 0xdc00] = [replacement, 'A', replacement] := by decide

end RunnerLogBounds
