import RunnerStructuredLog.Spec

namespace RunnerStructuredLog

theorem noMultipleArgs (args : Nat) (h : args ≠ 1) (root : Root)
    (severity : String) (payload : Payload) : output args root severity payload = none := by
  simp [output, accepts, h]

theorem noNonObject (args : Nat) (root : Root) (h : isObject root = false)
    (severity : String) (payload : Payload) : output args root severity payload = none := by
  simp [output, accepts, h]

theorem unsafeUtf16Declines (args : Nat) (root : Root) (severity : String)
    (depth : Nat) : output args root severity ⟨depth, false⟩ = none := by
  simp [output, accepts]

theorem depthAboveLimitDeclines (args : Nat) (root : Root) (severity : String)
    (depth : Nat) (h : 64 < depth) (wellFormed : Bool) :
    output args root severity ⟨depth, wellFormed⟩ = none := by
  simp [output, accepts, Nat.not_le_of_gt h]

theorem validAtBoundary (severity : String) (h : severity.toLower ∈ levels) :
    output 1 .object severity ⟨64, true⟩ = some severity.toLower := by
  simp [output, accepts, isObject, h]

theorem whitespaceKeepsObjectDecision (args : Nat) (severity : String) (payload : Payload) :
    output args .object severity payload = output args .whitespaceObject severity payload := rfl

end RunnerStructuredLog
