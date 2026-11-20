import FirestorePartitionRequest.Spec

namespace FirestorePartitionRequest

theorem kindlessNeverSplits (q : Shape) :
    FirestorePartitionRequest.decide { q with scope := .kindless } = .ok false := rfl

theorem limitPrecedesOtherClauses (q : Shape) :
    FirestorePartitionRequest.decide { q with scope := .group, limit := true } = .error .limit := rfl

theorem firstActiveWins (r : Refusal) (after : List (Bool × Refusal)) :
    firstRefusal ((true, r) :: after) = some r := rfl

theorem emulatorIgnoresProjection (q : Shape) (mask : Bool) :
    FirestorePartitionRequest.decide { q with strict := false, projection := mask } =
      FirestorePartitionRequest.decide { q with strict := false, projection := false } := rfl

theorem plainGroupSplitsExactlyWhenOrdered (strict ordered : Bool) :
    FirestorePartitionRequest.decide
      ⟨.group, strict, false, false, false, false, false, ordered⟩ = .ok ordered := by
  cases strict <;> rfl

theorem startPrecedesFinish (strict ordered : Bool) :
    FirestorePartitionRequest.decide
      ⟨.group, strict, false, false, false, true, true, ordered⟩ = .error .start := by
  cases strict <;> rfl

end FirestorePartitionRequest
