import RunnerInvocationBudget.Spec

namespace RunnerInvocationBudget

theorem accepted_respects_caps (cap : Cap) (state : State) (id : String) (payload : Nat)
    (ok : refusal cap state id payload = none) :
    (reserve cap state id payload).1.active.length ≤ cap.count ∧
    (reserve cap state id payload).1.bytes ≤ cap.bytes := by
  have limits : state.active.length < cap.count ∧ state.bytes + payload ≤ cap.bytes := by
    simp only [refusal] at ok
    split at ok
    · contradiction
    split at ok
    · contradiction
    split at ok
    · contradiction
    split at ok
    · contradiction
    split at ok
    · contradiction
    · omega
  simp only [reserve, ok, List.length_cons, State.bytes, List.map_cons, List.sum_cons]
  unfold State.bytes at limits
  omega

theorem refused_leaves_active_leases (cap : Cap) (state : State) (id : String)
    (payload : Nat) (why : Reason) (h : refusal cap state id payload = some why) :
    (reserve cap state id payload).1.active = state.active ∧
    (reserve cap state id payload).1.failed = true := by
  simp [reserve, h]

theorem failed_reservation_is_closed (cap : Cap) (state : State) (id : String) (payload : Nat)
    (h : state.failed = true) : refusal cap state id payload = some .closed := by
  simp [refusal, h]

theorem release_membership (state : State) (token : Nat) (lease : Lease) :
    lease ∈ (release state token).active ↔ lease ∈ state.active ∧ lease.token ≠ token := by
  simp [release, List.mem_filter]

theorem release_idempotent (state : State) (token : Nat) :
    release (release state token) token = release state token := by
  cases state
  simp [release, List.filter_filter, Bool.and_self]

theorem release_preserves_later_identity (state : State) (oldToken : Nat) (newLease : Lease)
    (live : newLease ∈ state.active) (different : newLease.token ≠ oldToken) :
    newLease ∈ (release state oldToken).active :=
  (release_membership _ _ _).mpr ⟨live, different⟩

theorem duplicate_precedes_both_caps (cap : Cap) (state : State) (id : String) (payload : Nat)
    (openState : state.failed = false) (nonEmpty : id.isEmpty = false)
    (nonZero : payload ≠ 0) (withinFrame : payload ≤ maxFrame)
    (duplicate : state.active.any (fun lease => lease.id == id) = true) :
    refusal cap state id payload = some .duplicate := by
  have legal : ¬ payload > maxFrame := by omega
  simp [refusal, openState, nonEmpty, nonZero, legal, duplicate]

end RunnerInvocationBudget
