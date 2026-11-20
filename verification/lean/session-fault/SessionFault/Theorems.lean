import SessionFault.Spec

namespace SessionFault

theorem preserves_rule_order (rules : List Rule) (prior : List Call) (c : Call) :
    (select rules prior c).Sublist (rules.map Rule.action) := by
  exact (List.filter_sublist (p := fires c prior)).map Rule.action

theorem overlapping_matches_are_both_retained (r s : Rule) (prior : List Call) (c : Call)
    (hr : fires c prior r = true) (hs : fires c prior s = true) :
    select [r, s] prior c = [r.action, s.action] := by
  simp [select, hr, hs]

theorem no_plan_records_nothing (calls : List Call) : fired none calls = [] := rfl

theorem retained_length (cap : Nat) (xs : List α) :
    (retained cap xs).length = min cap xs.length := by
  simp [retained]
  omega

theorem fits_keeps_all (cap : Nat) (xs : List α) (h : xs.length ≤ cap) :
    retained cap xs = xs := by
  simp [retained, Nat.sub_eq_zero_of_le h]

theorem retention_conserves_history (cap : Nat) (xs : List α) :
    (retained cap xs).length + (xs.length - cap) = xs.length := by
  rw [retained_length]
  omega

/-- A different event type still increments the function-specific occurrence counter. -/
theorem event_filter_does_not_scope_the_counter :
    let plan := [⟨"invoke", some "f2", some "created", some 2, 6⟩]
    fired (some plan) [⟨"invoke", some "f2", some "deleted"⟩, ⟨"invoke", some "f2", some "created"⟩]
      = [⟨"invoke", some "f2", 2, some 2, 6⟩] := by decide

end SessionFault
