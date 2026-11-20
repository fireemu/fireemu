import Std

namespace RulesCoveragePreviews

/-- UTF-8 byte length of a list of scalars when each element supplies its width. -/
def cost : List Nat → Nat
  | [] => 0
  | width :: rest => width + cost rest

/-- Select the longest initial sequence fitting the byte budget. -/
def fittingPrefix (budget : Nat) : List Nat → List Nat
  | [] => []
  | width :: rest =>
    if width ≤ budget then width :: fittingPrefix (budget - width) rest else []

theorem prefix_maximal (widths : List Nat) (budget : Nat) :
    ∃ remaining, widths = fittingPrefix budget widths ++ remaining ∧
      cost (fittingPrefix budget widths) ≤ budget ∧
      ∀ width rest, remaining = width :: rest → budget < cost (fittingPrefix budget widths) + width := by
  induction widths generalizing budget with
  | nil =>
    refine ⟨[], rfl, Nat.zero_le budget, ?_⟩
    intro width rest h
    cases h
  | cons width rest ih =>
    by_cases fits : width ≤ budget
    · obtain ⟨remaining, parts, within, maximal⟩ := ih (budget - width)
      refine ⟨remaining, ?_, ?_, ?_⟩
      · simp only [fittingPrefix, ite_eq_left fits, List.cons_append]
        exact congrArg (List.cons width) parts
      · simp only [fittingPrefix, ite_eq_left fits, cost]
        omega
      · intro next tail shape
        have excess := maximal next tail shape
        simp only [fittingPrefix, ite_eq_left fits, cost]
        omega
    · refine ⟨width :: rest, ?_, ?_, ?_⟩
      · simp [fittingPrefix, fits]
      · simp [fittingPrefix, fits, cost]
      · intro next tail shape
        have same := (List.cons.inj shape).1
        simp [fittingPrefix, fits, cost, ← same, Nat.lt_of_not_ge fits]

theorem complete_if_fits (widths : List Nat) (budget : Nat) (within : cost widths ≤ budget) :
    fittingPrefix budget widths = widths := by
  induction widths generalizing budget with
  | nil => rfl
  | cons width rest ih =>
    simp only [cost] at within
    have headFits : width ≤ budget := by omega
    have tailFits : cost rest ≤ budget - width := by omega
    simp [fittingPrefix, headFits, ih _ tailFits]

structure Preview where
  retained : List Nat
  truncated : Bool
  deriving DecidableEq

def preview (budget : Nat) (widths : List Nat) (alreadyTruncated : Bool) : Preview :=
  ⟨fittingPrefix budget widths, alreadyTruncated || decide (budget < cost widths)⟩

theorem input_tag_retained (widths : List Nat) (budget : Nat) :
    (preview budget widths true).truncated = true := by
  simp [preview]

theorem exact_value_keeps_its_tag (widths : List Nat) (budget : Nat) (within : cost widths ≤ budget) :
    preview budget widths false = ⟨widths, false⟩ := by
  simp [preview, complete_if_fits widths budget within, Nat.not_lt_of_ge within]

theorem clipped_preview_is_distinct_from_exact_value (widths : List Nat) (budget : Nat)
    (exceeds : budget < cost widths) :
    preview budget widths false ≠ preview budget (fittingPrefix budget widths) false := by
  obtain ⟨_, _, within, _⟩ := prefix_maximal widths budget
  intro equal
  have tags := congrArg Preview.truncated equal
  rw [exact_value_keeps_its_tag _ _ within] at tags
  simp [preview, exceeds] at tags

end RulesCoveragePreviews
