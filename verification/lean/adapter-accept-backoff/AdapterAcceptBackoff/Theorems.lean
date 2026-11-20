import AdapterAcceptBackoff.Spec

namespace AA

theorem bounded (n : Nat) : 100 ≤ backoff n ∧ backoff n ≤ 1000 := by
  unfold backoff
  split <;> try omega
  split <;> try omega
  split <;> try omega
  split <;> omega

theorem monotone (a b : Nat) (h : a ≤ b) : backoff a ≤ backoff b := by
  unfold backoff
  repeat' split
  all_goals omega

theorem stable_after_fifth (n : Nat) (h : 5 ≤ n) : backoff n = 1000 := by
  unfold backoff
  repeat' split
  all_goals omega

end AA
