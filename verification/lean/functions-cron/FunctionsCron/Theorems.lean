import FunctionsCron.Spec

namespace FunctionsCron

theorem restricted_days_disjoin (dom dow day weekday : Int) :
    admitsDay (some dom) (some dow) day weekday = ((day == dom) || (weekday == dow)) := by
  rfl

theorem window_contains_only_eligible_runs (start stop : Int) (runs : List Int)
    (x : Int) (h : x ∈ withinWindow start stop runs) :
    start < x * nanosPerSecond ∧ x * nanosPerSecond ≤ stop := by
  simpa [withinWindow] using (List.mem_filter.mp h).2

theorem window_enumeration_respects_cap (start stop : Int) (runs : List Int) (cap : Nat) :
    ((withinWindow start stop runs).take cap).length ≤ cap := by
  rw [List.length_take]
  exact Nat.min_le_left ..

theorem capped_is_exact_when_small (cap count : Nat) (h : count ≤ max 1 cap) :
    countRuns false cap count = (true, count) := by
  simp [countRuns, h]

theorem interval_count_is_exact (cap count : Nat) :
    countRuns true cap count = (true, count) := by
  simp [countRuns]

theorem next_interval_strictly_after (seconds period : Int) (positive : 0 < period) :
    seconds < (seconds / period + 1) * period := by
  exact Int.lt_ediv_add_one_mul_self seconds positive

theorem previous_interval_at_or_before (seconds period : Int) (positive : 0 < period) :
    (seconds / period) * period ≤ seconds := by
  exact Int.ediv_mul_le seconds (Int.ne_of_gt positive)

theorem reported_count_is_lower_bound (interval : Bool) (cap count : Nat) :
    (countRuns interval cap count).2 ≤ count := by
  unfold countRuns
  split
  · exact Nat.le_refl count
  · rename_i h
    have le : ¬count ≤ max 1 cap := by
      intro bound
      exact h (by simp [bound])
    exact Nat.le_of_lt (Nat.lt_of_not_ge le)

end FunctionsCron
